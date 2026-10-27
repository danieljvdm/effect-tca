import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { BoundActions, Store } from "../Store.ts";

export const bindActions = <S, A, Cases extends Record<string, Schema.Schema<NoInfer<A>>>>(
  store: Store<S, A>,
  actions: Schema.TaggedUnion<Cases>,
): BoundActions<Cases> =>
  // Each entry keeps its case's constructor input; Object.fromEntries erases that mapping.
  Object.fromEntries<unknown>(
    Object.entries(actions.cases).map(([tag, schema]) => [
      tag,
      (payload: object = {}) =>
        Effect.suspend(() =>
          Effect.flatMap(schema.makeEffect({ ...payload, _tag: tag }), store.send),
        ),
    ]),
  ) as BoundActions<Cases>;
