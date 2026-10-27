/**
 * Native Effect programs and streams owned by a mounted feature.
 * @since 0.0.1
 */
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import { normalize } from "./internal/featureEffect.ts";

/**
 * Names replaceable work within one mounted feature instance.
 * @category models
 * @since 0.0.1
 */
export type CancellationKey = string | symbol;

/**
 * Selects work belonging to the current feature instance. Siblings have separate keys.
 * @category models
 * @since 0.0.1
 */
export interface CancellationOptions {
  readonly cancellationKey: CancellationKey;
}

/**
 * Sends an action and waits for its transition to commit. Closed lifetimes cannot emit.
 * @category models
 * @since 0.0.1
 */
export type Send<A> = (action: A) => Effect.Effect<void>;

/**
 * An Effect emits its result once; a Stream emits each element sequentially.
 * Handle expected failures with native operators before returning the program.
 * @category models
 * @since 0.0.1
 */
export type Program<A, R = never> = Effect.Effect<A, never, R> | Stream.Stream<A, never, R>;

/**
 * Work returned from a reducer. Every program receives a resource scope and ends
 * with its owning feature lifetime. Stream emissions wait for each action to commit;
 * bound buffering separately for hot producers. Unexpected failures close the store.
 * @category models
 * @since 0.0.1
 */
export type FeatureEffect<A, R = never> = Program<A, R | Scope.Scope> | Run<A, R> | Cancel;

/**
 * The explicit result of a draft reducer: start work, cancel work, or do neither.
 * @category models
 * @since 0.0.1
 */
export type ReducerEffect<A, R = never> = Run<A, R> | Cancel | None;

/**
 * A reducer result that starts no asynchronous work. Return the context's `none`.
 * @category models
 * @since 0.0.1
 */
export interface None {
  /** @internal */
  readonly _tag: "None";
}

/**
 * Schema-derived action senders. Each Effect constructs and validates its action
 * when executed, then waits for the transition to commit. Invalid internally
 * constructed payloads are defects; handle untrusted input before sending it.
 * Senders belong to their execution and cannot emit after its lifetime closes.
 * @category models
 * @since 0.0.1
 */
export type Senders<Cases extends Record<string, Schema.Constraint>> = {
  readonly [K in keyof Cases]: (
    ...args: {} extends Omit<Cases[K]["~type.make.in"], "_tag">
      ? [payload?: Omit<Cases[K]["~type.make.in"], "_tag">]
      : [payload: Omit<Cases[K]["~type.make.in"], "_tag">]
  ) => Effect.Effect<void>;
};

/**
 * Effect constructors bound to the current action case and feature definition.
 * Every execution receives its own resource scope, closed with its feature lifetime.
 * Handle expected failures inside the workflow; send actions to change state after
 * the synchronous reducer has returned.
 * @category models
 * @since 0.0.1
 */
export interface Context<Cases extends Record<string, Schema.Constraint>> {
  /** Complete the transition without starting asynchronous work. */
  readonly none: None;
  /** Start independent work after the transition commits. */
  readonly run: {
    <Yield extends Effect.Effect<unknown, never, unknown>>(
      body: (send: Senders<Cases>) => Generator<Yield, void, never>,
    ): Run<Cases[keyof Cases]["Type"], Exclude<Effect.Services<Yield>, Scope.Scope>>;
    <R>(
      body: (send: Senders<Cases>) => Effect.Effect<void, never, R>,
    ): Run<Cases[keyof Cases]["Type"], Exclude<R, Scope.Scope>>;
  };
  /**
   * Replace this action case's previous execution before starting work. Its queued
   * actions are revoked too. Other cases and mounted feature instances are separate.
   */
  readonly replace: Context<Cases>["run"];
  /** Cancel replaceable work started by the selected action tag. A missing execution is a no-op. */
  readonly cancel: (tag: keyof Cases) => Cancel;
}

/**
 * Explicit action delivery or named replacement. Construct through a reducer
 * context, withSend, or replace.
 * @category models
 * @since 0.0.1
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
 * @since 0.0.1
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
 * @since 0.0.1
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
 * @since 0.0.1
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
 * @since 0.0.1
 */
export const cancel = (options: CancellationOptions): Cancel => ({
  _tag: "Cancel",
  key: options.cancellationKey,
  path: [],
});
