/**
 * Scoped runtimes for feature definitions.
 * @since 0.1.0-beta.0
 */
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type * as Feature from "./Feature.ts";
import { makeStore } from "./internal/store.ts";
import type { StoreError } from "./StoreError.ts";

/**
 * A running feature. Snapshots are immutable and subscriptions may coalesce
 * intermediate states. Scope disposal interrupts work and ends subscriptions.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Store<S, A> {
  readonly get: Effect.Effect<S>;
  readonly changes: Stream.Stream<S, StoreError>;
  /** Completes after the transition commits and its commands are registered. */
  readonly send: (action: A) => Effect.Effect<void, StoreError>;
  /** Completes on disposal; fails with the original runtime failure otherwise. */
  readonly closed: Effect.Effect<void, StoreError>;
}

/**
 * Store creation options. The queue defaults to 256 pending actions and applies
 * backpressure. A custom initial state is useful for previews and restoration.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Options<S> {
  readonly initialState?: S;
  readonly capacity?: number;
}

/**
 * Captures the feature's dependencies and runs it within the caller's scope.
 * Reducer and command defects close the store; expected failures belong in actions.
 * Invalid capacity or a throwing initializer fails with StoreError.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const make: <S, A, R>(
  feature: Feature.Definition<S, A, R>,
  options?: Options<S>,
) => Effect.Effect<Store<S, A>, StoreError, R | Scope.Scope> = makeStore;
