import * as Option from "effect/Option";
import { enableMapSet, freeze, Immer, isDraftable } from "immer";

import type { Draft, Transition } from "../Feature.ts";
import type * as FeatureEffect from "../FeatureEffect.ts";

enableMapSet();

// Keep freezing and class-copy policy local to this library's producers.
const immer = new Immer({ autoFreeze: true, useStrictShallowCopy: "class_only" });
const checked = new WeakSet<object>();
const objectConstructor = Function.prototype.toString.call(Object);

const unsupported = (): never => {
  throw new TypeError(
    "Draft feature state supports plain objects, arrays, Map, Set, Immer-enabled classes, and immutable Option values. Use Feature.make<State, Action>() for other state types.",
  );
};

/**
 * Immer passes opaque values and Map keys through unchanged. Freeze their entire
 * supported graph before exposing a draft, so those references cannot mutate an
 * earlier snapshot. Only fully checked, frozen branches enter the cache.
 */
const freezeSnapshot = (value: unknown, visiting: WeakSet<object>): void => {
  if (typeof value === "function") unsupported();
  if (value === null || typeof value !== "object" || checked.has(value)) return;
  if (visiting.has(value)) throw new TypeError("Draft feature state cannot contain cycles.");
  if (!isDraftable(value) && !Option.isOption(value)) unsupported();

  visiting.add(value);
  if (value instanceof Map || value instanceof Set) {
    for (const key of Reflect.ownKeys(value)) {
      // Frozen collections contain Immer's own throwing mutation methods.
      if (
        !Object.isFrozen(value) ||
        typeof key !== "string" ||
        !["set", "add", "clear", "delete"].includes(key) ||
        typeof Reflect.get(value, key) !== "function"
      ) {
        throw new TypeError("Draft state collections cannot have custom properties.");
      }
    }
  }
  if (value instanceof Map) {
    // Object.freeze(map) alone does not prevent .set/.delete. Immer's frozen Maps
    // have their own throwing mutators; already-frozen native Maps cannot acquire them.
    if (Object.isFrozen(value) && !Object.hasOwn(value, "set")) unsupported();
    for (const [key, entry] of value) {
      freezeSnapshot(key, visiting);
      freezeSnapshot(entry, visiting);
    }
  } else if (value instanceof Set) {
    if (Object.isFrozen(value) && !Object.hasOwn(value, "add")) unsupported();
    for (const entry of value) freezeSnapshot(entry, visiting);
  } else {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);

    const constructor =
      prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;

    const plain =
      prototype === null ||
      prototype === Object.prototype ||
      (typeof constructor === "function" &&
        Function.prototype.toString.call(constructor) === objectConstructor);

    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);

      if (descriptor === undefined || !("value" in descriptor)) return unsupported();
      if (array && key === "length") continue;
      if (
        array &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      ) {
        throw new TypeError("Draft state arrays cannot have custom properties.");
      }
      if ((plain || array) && !descriptor.enumerable) {
        throw new TypeError("Draft state objects and arrays require enumerable data fields.");
      }
      freezeSnapshot(descriptor.value, visiting);
    }
  }
  visiting.delete(value);
  if (Option.isOption(value)) Object.freeze(value);
  else freeze(value);
  checked.add(value);
};

export const snapshot = <S extends object>(state: S): S => {
  if (checked.has(state)) return state;
  if (!isDraftable(state)) unsupported();
  freezeSnapshot(state, new WeakSet());

  return state;
};

export const draftTransition = <S extends object, A, R>(
  state: S,
  reduce: (draft: Draft<S>) => FeatureEffect.ReducerEffect<A, R>,
): Transition<S, A, R> => {
  let effect: FeatureEffect.ReducerEffect<A, R> | undefined;

  const next = immer.produce<S, Draft<S>>(snapshot(state), (draft) => {
    // Returning the descriptor to Immer would replace state instead of committing
    // the recipe. Capture it separately; produce always revokes drafts on exit.
    effect = reduce(draft);
    if (effect?._tag !== "None" && effect?._tag !== "Run" && effect?._tag !== "Cancel") {
      throw new TypeError("A draft reducer must return effect.none, run, replace, or cancel.");
    }
  });

  if (effect === undefined) throw new TypeError("A draft reducer must return an effect.");
  const committed = snapshot(next);

  return effect._tag === "None" ? { state: committed } : { state: committed, effects: [effect] };
};
