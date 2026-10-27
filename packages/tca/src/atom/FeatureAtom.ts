/**
 * Registry-owned bindings to one scoped feature store.
 * @since 0.1.0-beta.0
 */
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as Feature from "../Feature.ts";
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
}

/**
 * Binds a feature to an application Atom runtime. Define bindings outside render.
 * Subscriptions and dispatch hold the store; after the last is released it is
 * disposed immediately. Separate registries receive independent stores.
 * Dispatch is asynchronous. Use a local draft for React controlled text inputs.
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const bind = <S, A, R, E>(
  feature: Feature.Definition<S, A, NoInfer<R> | Scope.Scope>,
  options: Store.Options<S> & { readonly runtime: Atom.AtomRuntime<R, E> },
): Binding<S, A, E> => {
  const session = options.runtime.atom(Store.make(feature, options)).pipe(Atom.setIdleTTL(0));

  const state = Atom.make((get) =>
    Stream.unwrap(Effect.map(get.result(session), (store) => store.changes)),
  ).pipe(Atom.setIdleTTL(0));

  const send = Atom.fn(
    Effect.fnUntraced(function* (action: A, get: Atom.FnContext) {
      get.mount(session);
      const store = yield* get.result(session);

      yield* store.send(action);
    }),
    { concurrent: true },
  ).pipe(Atom.setIdleTTL(0));

  return { state, send };
};
