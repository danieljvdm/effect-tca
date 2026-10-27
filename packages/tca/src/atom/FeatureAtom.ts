/**
 * Registry-owned bindings to one scoped feature store.
 * @since 0.1.0-beta.0
 */
import type * as Cause from "effect/Cause";
import type * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as Scope from "effect/Scope";

import type * as Feature from "../Feature.ts";
import {
  makeBinding,
  scopeBinding,
  type Session,
  type SessionTypeId,
} from "../internal/featureAtom.ts";
import * as Store from "../Store.ts";
import type { StoreError } from "../StoreError.ts";

/**
 * Read-only state and an action atom backed by the same store in each registry.
 * State starts Initial, then becomes Success; runtime failures become Failure.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Binding<S, A, E = never> {
  readonly state: Atom.Atom<AsyncResult.AsyncResult<S, E | StoreError | Cause.NoSuchElementError>>;
  readonly send: Atom.AtomResultFn<A, void, E | StoreError>;
  /** @internal */
  readonly [SessionTypeId]: Session<S, A, E>;
}

/**
 * Presence of a dynamic child. Each mounted lifetime has a stable binding;
 * removal yields None, and replacement yields a new binding. These dynamic
 * bindings belong to their originating registry; another registry rejects them.
 * @category models
 * @since 0.1.0-beta.0
 */
export type OptionalBinding<S, A, E = never> = Atom.Atom<
  AsyncResult.AsyncResult<
    Option.Option<Binding<S, A, E>>,
    E | StoreError | Cause.NoSuchElementError
  >
>;

/**
 * Binds a feature to an application Atom runtime. Define bindings outside render.
 * Subscriptions and dispatch hold the store; after the last is released it is
 * disposed immediately. Separate registries receive independent stores.
 * Dispatch is asynchronous. Use a local draft for React controlled text inputs.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const bind = <S, A, R, E, I>(
  feature: Feature.Definition<S, A, NoInfer<R> | Scope.Scope, I>,
  options: Store.Options<NoInfer<S>, NoInfer<I>> & { readonly runtime: Atom.AtomRuntime<R, E> },
): Binding<S, A, E> => {
  const session = options.runtime.atom(Store.make(feature, options)).pipe(Atom.setIdleTTL(0));

  return makeBinding<S, A, E>(session);
};

/**
 * Reuses a child descriptor to focus the parent binding without creating a store.
 * Required children return a binding. Optional children and `forEach.at(id)`
 * return a presence atom; render the resulting child binding while it is present.
 * Retained dispatchers fail with MissingChild after their lifetime ends.
 * Define scopes outside render and reuse them. Child subscriptions retain the
 * parent store; failures remain visible through the existing Atom result channels.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export function scope<S, A, E, CS, CA>(
  binding: Binding<S, A, E>,
  focus: Feature.Focus<NoInfer<S>, NoInfer<A>, CS, CA, "Child">,
): Binding<CS, CA, E>;

export function scope<S, A, E, CS, CA>(
  binding: Binding<S, A, E>,
  focus: Feature.Focus<NoInfer<S>, NoInfer<A>, CS, CA, "OptionalChild">,
): OptionalBinding<CS, CA, E>;

export function scope<S, A, E, CS, CA>(
  binding: Binding<S, A, E>,
  focus: Feature.Focus<S, A, CS, CA, "Child"> | Feature.Focus<S, A, CS, CA, "OptionalChild">,
): Binding<CS, CA, E> | OptionalBinding<CS, CA, E> {
  return scopeBinding(binding, focus);
}
