/**
 * Stepwise assertions over the production store runtime.
 * @since 0.1.0-beta.0
 */
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

import type * as Feature from "./Feature.ts";
import { makeRuntime } from "./internal/store.ts";
import type * as Store from "./Store.ts";
import { StoreError } from "./StoreError.ts";

/**
 * Assertions for a feature's actions and complete state snapshots.
 * Call finish before leaving the scope to detect unfinished work.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface TestStore<S, A> {
  readonly get: Effect.Effect<S>;
  readonly send: (action: A, update?: (previous: S) => S) => Effect.Effect<void, StoreError>;
  readonly receive: (action: A, update?: (previous: S) => S) => Effect.Effect<void, StoreError>;
  readonly finish: Effect.Effect<void, StoreError>;
}

/**
 * Supply the test runner's deep-equality assertion, for example assert.deepStrictEqual.
 * The receive timeout defaults to five seconds on the caller's Effect clock.
 * With a TestClock, advance time explicitly; the test runner still owns wall timeouts.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Options<S> extends Store.Options<S> {
  readonly assertEquals: (actual: unknown, expected: unknown) => void;
  readonly timeout?: Duration.Input;
}

/**
 * Runs a feature with held effect emissions and exhaustive snapshot assertions.
 * Expected state defaults to unchanged. Assertion failures retain their original cause.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const make = Effect.fnUntraced(function* <S, A, R>(
  feature: Feature.Definition<S, A, R>,
  options: Options<S>,
): Effect.fn.Return<TestStore<S, A>, StoreError, R | Scope.Scope> {
  const runtime = yield* makeRuntime(feature, options, true);

  const assert = (actual: unknown, expected: unknown) =>
    Effect.try({
      try: () => options.assertEquals(actual, expected),
      catch: (cause) =>
        StoreError.make({ reason: "Assertion", message: "TestStore expectation failed", cause }),
    });

  const expectedState = (previous: S, update?: (previous: S) => S) =>
    Effect.try({
      try: () => (update === undefined ? previous : update(previous)),
      catch: (cause) =>
        StoreError.make({ reason: "Assertion", message: "Expected-state callback failed", cause }),
    });

  const noPending = Effect.gen(function* () {
    yield* Effect.yieldNow;
    yield* runtime.checkOpen;
    const pending = yield* runtime.peek;

    if (Option.isSome(pending))
      return yield* StoreError.make({
        reason: "Assertion",
        message: "Receive pending effect actions before sending or finishing",
        cause: pending.value.action,
      });
  });

  return {
    get: runtime.store.get,
    send: Effect.fnUntraced(function* (action: A, update?: (previous: S) => S) {
      yield* noPending;
      const expected = yield* expectedState(yield* runtime.store.get, update);

      yield* runtime.store.send(action);
      yield* assert(yield* runtime.store.get, expected);
    }),
    receive: Effect.fnUntraced(function* (action: A, update?: (previous: S) => S) {
      const message = yield* runtime.take.pipe(
        Effect.timeout(options.timeout ?? "5 seconds"),
        Effect.catchTag("TimeoutError", (cause) =>
          Effect.fail(
            StoreError.make({
              reason: "Assertion",
              message: "Expected effect action did not arrive",
              cause,
            }),
          ),
        ),
      );

      yield* assert(message.action, action);
      const expected = yield* expectedState(yield* runtime.store.get, update);

      yield* runtime.commit(message);
      yield* assert(yield* runtime.store.get, expected);
    }),
    finish: Effect.gen(function* () {
      yield* noPending;
      const active = yield* runtime.active;

      if (active > 0)
        return yield* StoreError.make({
          reason: "Assertion",
          message: `${active} command(s) are still running`,
        });
    }),
  };
});
