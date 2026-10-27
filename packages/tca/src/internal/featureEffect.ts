import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type * as FeatureEffect from "../FeatureEffect.ts";

export type Operation<A, R> = FeatureEffect.Run<A, R> | FeatureEffect.Cancel;

export function normalize<A, R>(
  effect: FeatureEffect.Program<A, R> | FeatureEffect.Run<A, R>,
): FeatureEffect.Run<A, Exclude<R, Scope.Scope>>;

export function normalize<A, R>(effect: FeatureEffect.FeatureEffect<A, R>): Operation<A, R>;

export function normalize<A, R>(effect: FeatureEffect.FeatureEffect<A, R>): Operation<A, R> {
  if (Effect.isEffect(effect)) {
    return { _tag: "Run", key: undefined, run: (send) => Effect.flatMap(effect, send), path: [] };
  }
  if (Stream.isStream(effect)) {
    return {
      _tag: "Run",
      key: undefined,
      run: (send) => Stream.runForEach(effect, send),
      path: [],
    };
  }

  return effect;
}
