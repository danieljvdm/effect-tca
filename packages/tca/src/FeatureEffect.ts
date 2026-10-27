/**
 * Native Effect programs and streams owned by a mounted feature.
 * @since 0.1.0-beta.0
 */
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import { normalize } from "./internal/featureEffect.ts";

/**
 * Names replaceable work within one mounted feature instance.
 * @category models
 * @since 0.1.0-beta.0
 */
export type CancellationKey = string | symbol;

/**
 * Selects work belonging to the current feature instance. Siblings have separate keys.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface CancellationOptions {
  readonly cancellationKey: CancellationKey;
}

/**
 * Sends an action and waits for its transition to commit. Closed lifetimes cannot emit.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Send<A> = (action: A) => Effect.Effect<void>;

/**
 * An Effect emits its result once; a Stream emits each element sequentially.
 * Handle expected failures with native operators before returning the program.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Program<A, R = never> = Effect.Effect<A, never, R> | Stream.Stream<A, never, R>;

/**
 * Work returned from a reducer. Every program receives a resource scope and ends
 * with its owning feature lifetime. Stream emissions wait for each action to commit;
 * bound buffering separately for hot producers. Unexpected failures close the store.
 * @category models
 * @since 0.1.0-beta.0
 */
export type FeatureEffect<A, R = never> = Program<A, R | Scope.Scope> | Run<A, R> | Cancel;

/**
 * Explicit action delivery or named replacement. Construct with withSend or replace.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Run<A, R = never> {
  /** @internal */
  readonly _tag: "Run";
  /** @internal */
  readonly key: CancellationKey | undefined;
  /** @internal */
  readonly run: (send: Send<A>) => Effect.Effect<void, never, R | Scope.Scope>;
  /** @internal */
  readonly path: ReadonlyArray<string>;
}

/**
 * Cancels named work, including its queued actions. Construct with cancel.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Cancel {
  /** @internal */
  readonly _tag: "Cancel";
  /** @internal */
  readonly key: CancellationKey;
  /** @internal */
  readonly path: ReadonlyArray<string>;
}

/**
 * Provides explicit action delivery for workflows needing multiple acknowledged sends.
 * The callback runs after the reducer commits, within its own resource scope.
 * Use native Effects and Streams directly when their returned actions suffice.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export function withSend<A, R>(
  program: (send: Send<A>) => Effect.Effect<void, never, R>,
): Run<A, Exclude<R, Scope.Scope>>;

export function withSend<A, R>(
  program: (send: Send<A>) => Effect.Effect<void, never, R>,
): Run<A, R> {
  return { _tag: "Run", key: undefined, run: program, path: [] };
}

/**
 * Starts work after revoking the previous execution with this cancellation key.
 * Queued actions from the previous execution cannot commit. The key is local to
 * this mounted feature. Use native operators before this terminal adapter.
 * Supports replace(options, program) and program.pipe(replace(options)).
 * @category constructors
 * @since 0.1.0-beta.0
 */
export function replace(
  options: CancellationOptions,
): <A, R>(program: Program<A, R> | Run<A, R>) => Run<A, Exclude<R, Scope.Scope>>;

export function replace<A, R>(
  options: CancellationOptions,
  program: Program<A, R> | Run<A, R>,
): Run<A, Exclude<R, Scope.Scope>>;

export function replace<A, R>(
  options: CancellationOptions,
  program?: Program<A, R> | Run<A, R>,
):
  | Run<A, Exclude<R, Scope.Scope>>
  | (<A, R>(program: Program<A, R> | Run<A, R>) => Run<A, Exclude<R, Scope.Scope>>) {
  if (program === undefined) return (program) => replace(options, program);

  return { ...normalize(program), key: options.cancellationKey };
}

/**
 * Stops work with this feature-local cancellation key and rejects its queued actions.
 * A missing key is a no-op. Cleanup may continue after the cancelling action commits.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const cancel = (options: CancellationOptions): Cancel => ({
  _tag: "Cancel",
  key: options.cancellationKey,
  path: [],
});
