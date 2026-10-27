import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Feature from "../Feature.ts";
import type * as FeatureEffect from "../FeatureEffect.ts";
import type * as Store from "../Store.ts";
import { StoreError } from "../StoreError.ts";
import { normalize, type Operation } from "./featureEffect.ts";

interface Mounted {
  readonly scope: Scope.Closeable;
  readonly keys: Map<FeatureEffect.CancellationKey, Scope.Closeable>;
  closed?: Deferred.Deferred<void>;
}

interface Origin {
  readonly scope: Scope.Scope;
  readonly closed: Deferred.Deferred<void>;
}

/** @internal */
export const ScopeTypeId: unique symbol = Symbol.for("effect-tca/Store/scope");

export interface Message<A> {
  readonly action: A;
  readonly execution?: Scope.Scope;
  readonly origin?: Origin;
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
const isStoreError = Schema.is(StoreError);

// Parent closure revokes descendants before their finalizers have had time to run.
const isOpen = (scope: Scope.Scope | undefined): boolean => {
  for (let current = scope; current !== undefined; current = current.parent) {
    if (current.state._tag === "Closed") return false;
  }

  return true;
};

const valid = <A>(message: Message<A>) => isOpen(message.execution);

export const makeRuntime = Effect.fnUntraced(function* <S, A, R, I>(
  feature: Feature.Definition<S, A, R, I>,
  options: { readonly capacity?: number; readonly initialState?: S; readonly input?: I } = {},
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
    // Public constructors require input or initialState when the initializer needs it.
    try: () => {
      const initial =
        "initialState" in options
          ? (options.initialState as S)
          : feature.initial(options.input as I);

      feature.prepare?.(initial);

      return initial;
    },
    catch: (cause) =>
      StoreError.make({ reason: "Reducer", message: "Feature initialization failed", cause }),
  });

  const context = yield* Effect.context<R>();
  const scope = yield* Scope.make("parallel");
  const runCleanup = Effect.runForkWith(context);
  const inbox = yield* Queue.make<Message<A>>({ capacity });
  const emissions = yield* Queue.make<Message<A>>({ capacity });
  const snapshots = yield* PubSub.sliding<S>({ capacity: 1, replay: 1 });
  const closed = yield* Deferred.make<void, StoreError>();
  const mounted = new Map<string, Mounted>();
  const cleanupFibers = new Set<Fiber.Fiber<void>>();
  let running = 0;
  let stopped = false;
  let failure: StoreError | undefined;
  let cached: Message<A> | undefined;

  // Revocation is synchronous with the reducer turn. Cleanup cannot wait here:
  // the interrupted fiber may be waiting for this same turn's action receipt.
  const revoke = (target: Scope.Closeable, exit: Exit.Exit<unknown, unknown> = Exit.void): void => {
    const cleanup = Scope.closeUnsafe(target, exit);

    if (cleanup !== undefined) {
      // Detachment and supervision must be atomic: an interruptible hand-off
      // could lose the first (and only) cleanup returned by closeUnsafe.
      const fiber = runCleanup(Effect.andThen(Effect.yieldNow, cleanup), { uninterruptible: true });

      cleanupFibers.add(fiber);
      fiber.addObserver((result) => {
        if (Exit.isFailure(result) && !Cause.hasInterruptsOnly(result.cause)) {
          stopUnsafe(
            StoreError.make({
              reason: "Effect",
              message: "Effect cleanup failed unexpectedly",
              cause: result.cause,
            }),
          );
        }
        cleanupFibers.delete(fiber);
      });
    }
  };

  const stopUnsafe = (error: StoreError): void => {
    if (failure === undefined) failure = error;
    stopped = true;
    Deferred.doneUnsafe(closed, Effect.fail(failure));
    revoke(scope);
  };

  const stop = (error: StoreError): Effect.Effect<void> => Effect.sync(() => stopUnsafe(error));

  yield* Effect.addFinalizer((exit) =>
    Effect.gen(function* () {
      stopped = true;
      revoke(scope, exit);
      // A scope becomes Closed before its finalizers finish. Await the owned
      // cleanup fibers, including any cleanup added while another finishes.
      while (cleanupFibers.size > 0) yield* Fiber.awaitAll([...cleanupFibers]);
      if (failure === undefined) yield* Deferred.succeed(closed, undefined);
      else yield* Deferred.fail(closed, failure);
      yield* Queue.shutdown(inbox);
      yield* Queue.shutdown(emissions);
      yield* PubSub.shutdown(snapshots);
      if (failure !== undefined) return yield* Effect.die(failure);
    }),
  );

  const reconcile = (next: S): void => {
    const paths = new Set<string>();
    const additions: Array<readonly [string, ReadonlyArray<string>]> = [];

    for (const path of feature.lifetimes(next)) {
      const key = JSON.stringify(path);

      paths.add(key);
      if (!mounted.has(key)) additions.push([key, path]);
    }

    for (const [path, owner] of mounted) {
      if (paths.has(path)) continue;
      revoke(owner.scope);
      if (owner.closed !== undefined) Deferred.doneUnsafe(owner.closed, Effect.void);
      mounted.delete(path);
    }
    for (const [key, path] of additions.sort((a, b) => a[1].length - b[1].length)) {
      let parent = scope;

      for (let length = path.length - 1; length >= 0; length--) {
        const ancestor = mounted.get(JSON.stringify(path.slice(0, length)));

        if (ancestor !== undefined) {
          parent = ancestor.scope;
          break;
        }
      }
      mounted.set(key, { scope: Scope.forkUnsafe(parent, "parallel"), keys: new Map() });
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

  const live = (origin: Origin): boolean => isOpen(origin.scope);

  const missing = () =>
    StoreError.make({ reason: "MissingChild", message: "The scoped child is no longer present" });

  const send = Effect.fnUntraced(function* (action: A, execution?: Scope.Scope, origin?: Origin) {
    if (!isOpen(execution)) return;
    if (origin !== undefined && !live(origin)) return yield* missing();

    const receipt = yield* Deferred.make<void, StoreError>();

    yield* submit(
      { action, execution, origin, receipt },
      execution !== undefined && testing ? emissions : inbox,
    );
  });

  const launch = Effect.fnUntraced(function* (command: Operation<A, R>) {
    const owner = mounted.get(JSON.stringify(command.path));

    // A child may have emitted work during the same action that removed it.
    if (owner === undefined || stopped || !isOpen(owner.scope)) return;
    if (command.key !== undefined) {
      const previous = owner.keys.get(command.key);

      if (previous !== undefined) revoke(previous);
      owner.keys.delete(command.key);
    }
    if (command._tag === "Cancel") return;

    const execution = Scope.forkUnsafe(owner.scope, "parallel");

    running++;
    if (command.key !== undefined) owner.keys.set(command.key, execution);

    const program = Effect.suspend(() =>
      command.run((action) => send(action, execution).pipe(Effect.catch(() => Effect.interrupt))),
    );

    yield* program.pipe(
      Effect.scoped,
      Effect.provideContext(context),
      Effect.onExit((exit) => {
        // User resources have finished above. This scope owns only this fiber;
        // its self-finalizer does not wait. onExit runs cleanup uninterruptibly.
        running--;
        if (command.key !== undefined && owner.keys.get(command.key) === execution)
          owner.keys.delete(command.key);
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          stopUnsafe(
            StoreError.make({
              reason: "Effect",
              message: "An effect failed unexpectedly",
              cause: exit.cause,
            }),
          );
        }

        return Scope.closeUnsafe(execution, exit) ?? Effect.void;
      }),
      Effect.forkIn(execution),
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
    if (message.origin !== undefined && !live(message.origin)) {
      yield* Deferred.fail(message.receipt, missing());

      return;
    }

    const transition = yield* Effect.try({
      try: () => {
        const result = feature.reduce(state, message.action);

        feature.prepare?.(result.state);
        reconcile(result.state);
        state = result.state;
        PubSub.publishUnsafe(snapshots, state);

        return result;
      },
      catch: (cause) => StoreError.make({ reason: "Reducer", message: "A reducer failed", cause }),
    });

    for (const effect of transition.effects ?? []) yield* launch(normalize(effect));
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

  const makeView = <VS, VA>(
    select: (state: S) => Option.Option<VS>,
    embed: (action: VA) => A,
    path: ReadonlyArray<string>,
    origin?: Origin,
  ): Store.Store<VS, VA> => {
    const cache = new WeakMap<object, { readonly scope: Scope.Scope; readonly view: object }>();

    const viewClosed =
      origin === undefined
        ? Deferred.await(closed)
        : Effect.raceFirst(Deferred.await(closed), Deferred.await(origin.closed));

    const read = (): VS => {
      if (stopped) throw failure ?? disposed();
      if (origin !== undefined && !live(origin)) throw missing();
      const selected = select(state);

      if (Option.isNone(selected)) throw missing();

      return selected.value;
    };

    const scopeChild = <CS, CA>(focus: Feature.Focus<VS, VA, CS, CA>) =>
      Effect.try({
        try: (): Option.Option<Store.Store<CS, CA>> => {
          const parent = read();
          const tail = focus.path(parent);

          if (Option.isNone(tail) || Option.isNone(focus.select(parent))) return Option.none();
          const childPath = [...path, ...tail.value];
          const key = JSON.stringify(childPath);
          const owner = mounted.get(key);

          if (owner === undefined)
            throw StoreError.make({
              reason: "MissingChild",
              message: "The child descriptor is not mounted in this feature",
            });
          const cachedView = cache.get(focus);

          if (cachedView?.scope === owner.scope) {
            // A descriptor fixes CS/CA; this cache only erases those parameters for storage.
            return Option.some(cachedView.view as Store.Store<CS, CA>);
          }

          const child = makeView(
            (snapshot) => Option.flatMap(select(snapshot), focus.select),
            (action: CA) => embed(focus.embed(action)),
            childPath,
            { scope: owner.scope, closed: (owner.closed ??= Deferred.makeUnsafe<void>()) },
          );

          cache.set(focus, { scope: owner.scope, view: child });

          return Option.some(child);
        },
        catch: (cause) =>
          isStoreError(cause)
            ? cause
            : StoreError.make({ reason: "MissingChild", message: "Unable to select child", cause }),
      });

    return {
      get: Effect.try({
        try: read,
        catch: (cause) =>
          isStoreError(cause)
            ? cause
            : StoreError.make({ reason: "MissingChild", message: "Unable to read child", cause }),
      }),
      changes: Stream.fromPubSub(snapshots).pipe(
        Stream.interruptWhen(viewClosed),
        Stream.filter(() => origin === undefined || live(origin)),
        Stream.map(select),
        Stream.filter(Option.isSome),
        Stream.map((selected) => selected.value),
      ),
      send: (action) =>
        Effect.flatMap(
          Effect.try({
            try: () => embed(action),
            catch: (cause) =>
              StoreError.make({
                reason: "MissingChild",
                message: "Unable to route child action",
                cause,
              }),
          }),
          (action) => send(action, undefined, origin),
        ),
      closed: viewClosed,
      [ScopeTypeId]: scopeChild,
    };
  };

  return {
    store: {
      ...makeView(
        (snapshot) => Option.some(snapshot),
        (action: A) => action,
        [],
      ),
      get: Effect.sync(() => state),
      changes: Stream.fromPubSub(snapshots).pipe(Stream.interruptWhen(Deferred.await(closed))),
      send: (action) => send(action),
    },
    peek,
    take,
    commit: (message) => submit(message, inbox),
    active: Effect.sync(() => running + cleanupFibers.size),
    checkOpen: Effect.suspend(() => (stopped ? Effect.fail(failure ?? disposed()) : Effect.void)),
  };
});

export const makeStore = Effect.fnUntraced(function* <S, A, R, I>(
  feature: Feature.Definition<S, A, R, I>,
  options?: { readonly capacity?: number; readonly initialState?: S; readonly input?: I },
) {
  const runtime = yield* makeRuntime(feature, options);

  return runtime.store;
});
