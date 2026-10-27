/**
 * Scoped runtimes for feature definitions.
 * @since 0.0.1
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

import type * as Feature from "./Feature.ts";
import { bindActions as bindActionSenders } from "./internal/boundActions.ts";
import { makeStore, ScopeTypeId } from "./internal/store.ts";
import { StoreError } from "./StoreError.ts";

/**
 * A running feature. Snapshots are immutable and subscriptions may coalesce
 * intermediate states. Scope disposal interrupts work and ends subscriptions.
 * @category models
 * @since 0.0.1
 */
export interface Store<S, A> {
  readonly get: Effect.Effect<S, StoreError>;
  readonly changes: Stream.Stream<S, StoreError>;
  /** Completes after the transition commits and its effects are registered. */
  readonly send: (action: A) => Effect.Effect<void, StoreError>;
  /** Completes on disposal; fails with the original runtime failure otherwise. */
  readonly closed: Effect.Effect<void, StoreError>;
  /** @internal */
  readonly [ScopeTypeId]: <CS, CA>(
    focus: Feature.Focus<S, A, CS, CA>,
  ) => Effect.Effect<Option.Option<Store<CS, CA>>, StoreError>;
}

/**
 * Store creation options. The queue defaults to 256 pending actions and applies
 * backpressure. A custom initial state is useful for previews and restoration.
 * Supply input when the initializer requires it, or provide initialState to bypass
 * initialization. When both are present, initialState takes precedence.
 * @category models
 * @since 0.0.1
 */
export type Options<S, I = void> = {
  readonly capacity?: number;
} & ([I] extends [void]
  ? { readonly initialState?: S; readonly input?: I }
  :
      | { readonly initialState: S; readonly input?: I }
      | { readonly input: I; readonly initialState?: S });

/**
 * Captures the feature's dependencies and runs it within the caller's scope.
 * Reducer and effect defects close the store; expected failures belong in actions.
 * Invalid capacity or a throwing initializer fails with StoreError.
 * @category constructors
 * @since 0.0.1
 */
export const make: <S, A, R, I>(
  feature: Feature.Definition<S, A, R, I>,
  ...options: [I] extends [void]
    ? [options?: Options<NoInfer<S>, NoInfer<I>>]
    : [options: Options<NoInfer<S>, NoInfer<I>>]
) => Effect.Effect<Store<S, A>, StoreError, R | Scope.Scope> = makeStore;

/**
 * Named action senders. Payloads use each case's constructor input, including
 * defaults, without its discriminator. Cases with no required payload fields
 * can be called without an argument.
 * @category models
 * @since 0.0.1
 */
export type BoundActions<Cases extends Record<string, Schema.Constraint>> = {
  readonly [K in keyof Cases]: (
    ...args: {} extends Omit<Cases[K]["~type.make.in"], "_tag">
      ? [payload?: Omit<Cases[K]["~type.make.in"], "_tag">]
      : [payload: Omit<Cases[K]["~type.make.in"], "_tag">]
  ) => Effect.Effect<void, SchemaIssue.Issue | StoreError>;
};

/**
 * Derives named senders from an action schema. Each returned Effect applies
 * constructor defaults, validates the payload, and waits for the action to
 * commit through this store. Schema failures do not dispatch. Binding or calling
 * a sender does no work; scoped senders retain their original child lifetime.
 * @category combinators
 * @since 0.0.1
 */
export const bindActions: <S, A, Cases extends Record<string, Schema.Schema<NoInfer<A>>>>(
  store: Store<S, A>,
  actions: Schema.TaggedUnion<Cases>,
) => BoundActions<Cases> = bindActionSenders;

/**
 * Focuses the existing runtime using a feature's child descriptor. Optional
 * children and collection entries (`children.at(id)`) return None when absent.
 * A handle belongs to the selected lifetime: after removal its reads and sends
 * fail with MissingChild, and its subscriptions and `closed` complete. Re-scope
 * the parent to obtain a handle for a new lifetime, even when its ID is reused.
 * @category combinators
 * @since 0.0.1
 */
export function scope<S, A, CS, CA>(
  store: Store<S, A>,
  focus: Feature.Focus<NoInfer<S>, NoInfer<A>, CS, CA, "Child">,
): Effect.Effect<Store<CS, CA>, StoreError>;

export function scope<S, A, CS, CA>(
  store: Store<S, A>,
  focus: Feature.Focus<NoInfer<S>, NoInfer<A>, CS, CA, "OptionalChild">,
): Effect.Effect<Option.Option<Store<CS, CA>>, StoreError>;

export function scope<S, A, CS, CA>(
  store: Store<S, A>,
  focus: Feature.Focus<S, A, CS, CA>,
): Effect.Effect<Store<CS, CA> | Option.Option<Store<CS, CA>>, StoreError> {
  const selected = store[ScopeTypeId](focus);

  return focus._tag === "Child"
    ? Effect.flatMap(
        selected,
        Option.match({
          onNone: () =>
            Effect.fail(StoreError.make({ reason: "MissingChild", message: "Child is absent" })),
          onSome: Effect.succeed,
        }),
      )
    : selected;
}
