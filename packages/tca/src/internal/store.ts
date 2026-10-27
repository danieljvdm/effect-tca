import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Command from "../Command.ts";
import type * as Feature from "../Feature.ts";
import type * as Store from "../Store.ts";
import { StoreError } from "../StoreError.ts";

interface Owner {
  readonly executions: Set<Execution>;
  readonly keys: Map<Command.Key, Execution>;
}

interface Execution {
  valid: boolean;
  fiber?: Fiber.Fiber<void>;
}

export interface Message<A> {
  readonly action: A;
  readonly execution?: Execution;
  readonly receipt: Deferred.Deferred<void, StoreError>;
}

export interface Runtime<S, A> {
  readonly store: Store.Store<S, A>;
  readonly take: Effect.Effect<Message<A>, StoreError>;
  readonly peek: Effect.Effect<Option.Option<Message<A>>>;
  readonly commit: (message: Message<A>) => Effect.Effect<void, StoreError>;
  readonly active: Effect.Effect<number>;
  readonly checkOpen: Effect.Effect<void, StoreError>;
}

const disposed = () => StoreError.make({ reason: "Closed", message: "The store is closed" });
const valid = <A>(message: Message<A>) => message.execution?.valid ?? true;

// Invalidating is synchronous with the turn. Waiting for interruption here would
// deadlock a command that is currently waiting for its own action's receipt.
const invalidate = (execution: Execution): void => {
  execution.valid = false;
  execution.fiber?.interruptUnsafe();
};

export const makeRuntime = Effect.fnUntraced(function* <S, A, R>(
  feature: Feature.Definition<S, A, R>,
  options: Store.Options<S> = {},
  testing = false,
): Effect.fn.Return<Runtime<S, A>, StoreError, R | Scope.Scope> {
  const capacity = options.capacity ?? 256;

  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    return yield* StoreError.make({
      reason: "Reducer",
      message: "capacity must be a positive safe integer",
    });
  }

  let state = yield* Effect.try({
    try: () => (options.initialState === undefined ? feature.initial() : options.initialState),
    catch: (cause) =>
      StoreError.make({ reason: "Reducer", message: "Feature initialization failed", cause }),
  });

  const context = yield* Effect.context<R>();
  const scope = yield* Scope.make("parallel");
  const inbox = yield* Queue.make<Message<A>>({ capacity });
  const emissions = yield* Queue.make<Message<A>>({ capacity });
  const snapshots = yield* PubSub.sliding<S>({ capacity: 1, replay: 1 });
  const closed = yield* Deferred.make<void, StoreError>();
  const owners = new Map<string, Owner>();
  const executions = new Set<Execution>();
  let stopped = false;
  let failure: StoreError | undefined;
  let cached: Message<A> | undefined;

  const stop = (error: StoreError): Effect.Effect<void> =>
    Effect.sync(() => {
      if (failure === undefined) failure = error;
      stopped = true;
      Deferred.doneUnsafe(closed, Effect.fail(failure));
      for (const execution of executions) invalidate(execution);
    });

  yield* Effect.addFinalizer((exit) =>
    Effect.gen(function* () {
      stopped = true;
      for (const execution of executions) invalidate(execution);
      yield* Scope.close(scope, exit);
      if (failure === undefined) yield* Deferred.succeed(closed, undefined);
      else yield* Deferred.fail(closed, failure);
      yield* Queue.shutdown(inbox);
      yield* Queue.shutdown(emissions);
      yield* PubSub.shutdown(snapshots);
      if (failure !== undefined) return yield* Effect.die(failure);
    }),
  );

  const reconcile = (next: S): void => {
    const paths = new Set(feature.lifetimes(next).map((path) => JSON.stringify(path)));

    for (const [path, owner] of owners) {
      if (paths.has(path)) continue;
      for (const execution of owner.executions) invalidate(execution);
      owners.delete(path);
    }
    for (const path of paths) {
      if (!owners.has(path)) owners.set(path, { executions: new Set(), keys: new Map() });
    }
  };

  yield* Effect.try({
    try: () => reconcile(state),
    catch: (cause) =>
      StoreError.make({ reason: "Reducer", message: "Invalid initial child state", cause }),
  });
  yield* PubSub.publish(snapshots, state);

  const untilClosed = <B>(effect: Effect.Effect<B, StoreError>): Effect.Effect<B, StoreError> =>
    Effect.raceFirst(effect, Deferred.await(closed).pipe(Effect.andThen(Effect.fail(disposed()))));

  const submit = (
    message: Message<A>,
    target: Queue.Queue<Message<A>>,
  ): Effect.Effect<void, StoreError> =>
    Effect.suspend(() =>
      stopped
        ? Effect.fail(failure ?? disposed())
        : untilClosed(
            Queue.offer(target, message).pipe(Effect.andThen(Deferred.await(message.receipt))),
          ),
    );

  const send = Effect.fnUntraced(function* (action: A, execution?: Execution) {
    if (execution !== undefined && !execution.valid) return;

    const receipt = yield* Deferred.make<void, StoreError>();

    yield* submit(
      { action, execution, receipt },
      execution !== undefined && testing ? emissions : inbox,
    );
  });

  const launch = Effect.fnUntraced(function* (command: Command.Command<A, R>) {
    const owner = owners.get(JSON.stringify(command.path));

    // A child may have emitted work during the same action that removed it.
    if (owner === undefined || stopped) return;
    if (command.key !== undefined) {
      const previous = owner.keys.get(command.key);

      if (previous !== undefined) invalidate(previous);
      owner.keys.delete(command.key);
    }
    if (command._tag === "Cancel") return;

    const execution: Execution = { valid: true };

    owner.executions.add(execution);
    executions.add(execution);
    if (command.key !== undefined) owner.keys.set(command.key, execution);

    const program = Effect.suspend(() =>
      command.run((action) => send(action, execution).pipe(Effect.catch(() => Effect.interrupt))),
    );

    execution.fiber = yield* program.pipe(
      Effect.scoped,
      Effect.provideContext(context),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          execution.valid = false;
          executions.delete(execution);
          owner.executions.delete(execution);
          if (command.key !== undefined && owner.keys.get(command.key) === execution)
            owner.keys.delete(command.key);
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
            yield* stop(
              StoreError.make({
                reason: "Command",
                message: "A command failed unexpectedly",
                cause: exit.cause,
              }),
            );
          }
        }),
      ),
      Effect.forkIn(scope),
    );
  });

  const process = Effect.fnUntraced(function* (message: Message<A>) {
    if (!valid(message)) {
      yield* Deferred.succeed(message.receipt, undefined);

      return;
    }
    if (stopped) {
      yield* Deferred.fail(message.receipt, failure ?? disposed());

      return;
    }

    const transition = yield* Effect.try({
      try: () => {
        const result = feature.reduce(state, message.action);

        reconcile(result.state);
        state = result.state;
        PubSub.publishUnsafe(snapshots, state);

        return result;
      },
      catch: (cause) => StoreError.make({ reason: "Reducer", message: "A reducer failed", cause }),
    });

    for (const command of transition.commands ?? []) yield* launch(command);
    yield* Deferred.succeed(message.receipt, undefined);
  });

  yield* Effect.forever(Queue.take(inbox).pipe(Effect.flatMap(process))).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : stop(
            StoreError.make({ reason: "Reducer", message: "The action processor failed", cause }),
          ),
    ),
    Effect.forkIn(scope),
  );

  const peek = Effect.gen(function* () {
    if (cached !== undefined && valid(cached)) return Option.some(cached);
    if (cached !== undefined) yield* Deferred.succeed(cached.receipt, undefined);
    cached = undefined;
    while (true) {
      const next = yield* Queue.poll(emissions);

      if (Option.isNone(next)) return Option.none<Message<A>>();
      if (valid(next.value)) {
        cached = next.value;

        return next;
      }
      yield* Deferred.succeed(next.value.receipt, undefined);
    }
  });

  const take = untilClosed(
    Effect.gen(function* () {
      const available = yield* peek;

      if (Option.isSome(available)) {
        cached = undefined;

        return available.value;
      }
      while (true) {
        const message = yield* Queue.take(emissions);

        if (valid(message)) return message;
        yield* Deferred.succeed(message.receipt, undefined);
      }
    }),
  );

  return {
    store: {
      get: Effect.sync(() => state),
      changes: Stream.fromPubSub(snapshots).pipe(Stream.interruptWhen(Deferred.await(closed))),
      send: (action) => send(action),
      closed: Deferred.await(closed),
    },
    peek,
    take,
    commit: (message) => submit(message, inbox),
    active: Effect.sync(() => executions.size),
    checkOpen: Effect.suspend(() => (stopped ? Effect.fail(failure ?? disposed()) : Effect.void)),
  };
});

export const makeStore = Effect.fnUntraced(function* <S, A, R>(
  feature: Feature.Definition<S, A, R>,
  options?: Store.Options<S>,
) {
  const runtime = yield* makeRuntime(feature, options);

  return runtime.store;
});
