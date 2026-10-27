import * as Optic from "effect/Optic";
import * as Option from "effect/Option";
import { pipeArguments } from "effect/Pipeable";
import * as Predicate from "effect/Predicate";

import type { Definition, Route, Transition } from "../Feature.ts";

export const makeDefinition = <S, A, R = never, I = void>(spec: {
  readonly initial: (input: I) => S;
  readonly reduce: (state: S, action: A) => Transition<S, A, R>;
}): Definition<S, A, R, I> => ({
  ...spec,
  lifetimes: () => [[]],
  routes: [],
  pipe() {
    return pipeArguments(this, arguments);
  },
});

export const stateLens = <S, CS>(state: Optic.Lens<S, CS> | keyof S): Optic.Lens<S, CS> =>
  Predicate.isPropertyKey(state)
    ? // Public options only admit keys whose value type matches the child state.
      (Optic.id<Record<PropertyKey, CS>>().key(state) as unknown as Optic.Lens<S, CS>)
    : state;

export const actionRoute = <A, CA>(action: Route<A, CA> | string): Route<A, CA> => {
  if (!Predicate.isString(action)) return action;

  return {
    key: action,
    extract: (value) => {
      // Public options admit only tagged cases with exactly this action payload.
      const tagged = value as { readonly _tag: string; readonly action: CA };

      return tagged._tag === action ? Option.some(tagged.action) : Option.none();
    },
    embed: (value) => ({ _tag: action, action: value }) as A,
  };
};
