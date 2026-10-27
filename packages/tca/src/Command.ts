/**
 * Effect programs owned by a feature instance.
 * @since 0.1.0-beta.0
 */
import type * as Effect from "effect/Effect";

/**
 * A cancellation key, local to one mounted feature instance.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Key = string | symbol;

/**
 * Emits an action and waits for its turn to commit. Obsolete executions cannot emit.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Send<A> = (action: A) => Effect.Effect<void>;

/**
 * A command description. Use the constructors rather than assembling it manually.
 * Expected failures must be handled in the program; defects close the store.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Command<A, R = never> = Run<A, R> | Cancel;

/**
 * Work with its own resource scope. A key replaces earlier work with that key.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Run<A, R = never> {
  readonly _tag: "Run";
  readonly key: Key | undefined;
  readonly run: (send: Send<A>) => Effect.Effect<void, never, R>;
  /** @internal */
  readonly path: ReadonlyArray<string>;
}

/**
 * Invalidates and interrupts keyed work in the owning feature.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Cancel {
  readonly _tag: "Cancel";
  readonly key: Key;
  /** @internal */
  readonly path: ReadonlyArray<string>;
}

/**
 * Runs work concurrently with other commands. The feature lifetime owns it.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const run = <A, R>(
  program: (send: Send<A>) => Effect.Effect<void, never, R>,
): Command<A, R> => ({
  _tag: "Run",
  key: undefined,
  run: program,
  path: [],
});

/**
 * Replaces work with the same key, fencing even its already queued emissions.
 * Keys are scoped to the feature instance, so siblings never cancel each other.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const latest = <A, R>(
  key: Key,
  program: (send: Send<A>) => Effect.Effect<void, never, R>,
): Command<A, R> => ({
  _tag: "Run",
  key,
  run: program,
  path: [],
});

/**
 * Cancels work with a local key. Missing keys are a no-op.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const cancel = (key: Key): Cancel => ({ _tag: "Cancel", key, path: [] });

/**
 * Maps every emitted action while preserving cancellation and resource ownership.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export const map = <A, B, R>(self: Command<A, R>, f: (action: A) => B): Command<B, R> =>
  self._tag === "Cancel" ? self : { ...self, run: (send) => self.run((action) => send(f(action))) };
