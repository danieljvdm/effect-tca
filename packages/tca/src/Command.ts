/**
 * Effect programs owned by a feature instance.
 * @since 0.1.0-beta.0
 */
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Stream from "effect/Stream";

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
 * Work that emits one action, a stream of actions, or uses an explicit sender.
 * Handle expected failures before constructing a command. Every emission waits
 * for its action to commit, and the command owns the program's resource scope.
 * @category models
 * @since 0.1.0-beta.0
 */
export type Program<A, R = never> =
  | Effect.Effect<A, never, R>
  | Stream.Stream<A, never, R>
  | ((send: Send<A>) => Effect.Effect<void, never, R>);

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
 * An Effect emits its result once; a Stream emits sequentially. Each action waits
 * for its commit. Use a send callback for explicit emission control. Handle expected
 * failures in every form. Bound buffering separately for hot stream producers.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const run = <A, R>(program: Program<A, R>): Command<A, R> => ({
  _tag: "Run",
  key: undefined,
  run: Effect.isEffect(program)
    ? (send) => Effect.flatMap(program, send)
    : Stream.isStream(program)
      ? (send) => Stream.runForEach(program, send)
      : program,
  path: [],
});

/**
 * Replaces work with the same key, fencing even its already queued emissions.
 * Keys are scoped to the feature instance, so siblings never cancel each other.
 * Accepts an action-returning Effect, a Stream of actions, or a send callback.
 * Every form waits for emitted actions to commit and requires expected errors handled.
 * Supports `latest(key, program)` and `program.pipe(latest(key))`.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export function latest(key: Key): <A, R>(program: Program<A, R>) => Command<A, R>;
export function latest<A, R>(key: Key, program: Program<A, R>): Command<A, R>;

export function latest<A, R>(
  key: Key,
  program?: Program<A, R>,
): Command<A, R> | (<A, R>(program: Program<A, R>) => Command<A, R>) {
  if (program === undefined) return (program) => latest(key, program);

  return { ...run(program), key };
}

/**
 * Cancels work with a local key. Missing keys are a no-op.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const cancel = (key: Key): Cancel => ({ _tag: "Cancel", key, path: [] });

/**
 * Maps every emitted action while preserving cancellation and resource ownership.
 * Supports `map(command, f)` and `pipe(command, map(f))`.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export const map: {
  <A, B>(f: (action: A) => B): <R>(self: Command<A, R>) => Command<B, R>;
  <A, B, R>(self: Command<A, R>, f: (action: A) => B): Command<B, R>;
} = dual(2, <A, B, R>(self: Command<A, R>, f: (action: A) => B): Command<B, R> =>
  self._tag === "Cancel" ? self : { ...self, run: (send) => self.run((action) => send(f(action))) },
);
