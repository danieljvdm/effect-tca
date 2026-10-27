import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import type { Binding, OptionalBinding } from "../atom/FeatureAtom.ts";
import type * as Feature from "../Feature.ts";
import * as Store from "../Store.ts";
import { StoreError } from "../StoreError.ts";

export const SessionTypeId: unique symbol = Symbol.for("effect-tca/atom/session");

export type Session<S, A, E> = Atom.Atom<
  AsyncResult.AsyncResult<Store.Store<S, A>, E | StoreError>
>;

export const makeBinding = <S, A, E>(session: Session<S, A, E>): Binding<S, A, E> => {
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

  return { state, send, [SessionTypeId]: session };
};

export const scopeBinding = <S, A, E, CS, CA>(
  binding: Binding<S, A, E>,
  focus: Feature.Focus<S, A, CS, CA, "Child"> | Feature.Focus<S, A, CS, CA, "OptionalChild">,
): Binding<CS, CA, E> | OptionalBinding<CS, CA, E> => {
  const parent = binding[SessionTypeId];

  if (focus._tag === "Child") {
    const session = Atom.make((get) =>
      Effect.flatMap(get.result(parent), (store) => Store.scope(store, focus)),
    ).pipe(Atom.setIdleTTL(0));

    return makeBinding<CS, CA, E>(session);
  }

  // A binding is stable within one mounted lifetime. Weak keys allow removed
  // children and their closures to be released once consumers drop them.
  const children = new WeakMap<Store.Store<CS, CA>, Binding<CS, CA, E>>();

  return Atom.make((get) =>
    Stream.unwrap(
      Effect.map(get.result(parent), (store) =>
        store.changes.pipe(
          Stream.mapEffect(() => Store.scope(store, focus)),
          Stream.map(
            Option.map((child) => {
              const existing = children.get(child);

              if (existing !== undefined) return existing;

              // Reading the parent session retains its owning store while this child
              // has subscribers, even if the presence atom is no longer mounted.
              const session = Atom.make((get) =>
                Effect.flatMap(get.result(parent), (current) =>
                  current === store
                    ? Effect.succeed(child)
                    : Effect.fail(
                        StoreError.make({
                          reason: "MissingChild",
                          message:
                            "The scoped child belongs to a different parent store or registry",
                        }),
                      ),
                ),
              ).pipe(Atom.setIdleTTL(0));

              const selected = makeBinding<CS, CA, E>(session);

              children.set(child, selected);

              return selected;
            }),
          ),
          Stream.changesWith((left, right) =>
            Option.isNone(left)
              ? Option.isNone(right)
              : Option.isSome(right) && left.value === right.value,
          ),
        ),
      ),
    ),
  ).pipe(Atom.setIdleTTL(0));
};
