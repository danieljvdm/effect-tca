# effect-tca

Immutable feature reducers, scoped effects, typed child composition,
and a TestStore for complete action and state assertions.

```sh
bun add effect-tca effect
```

```ts
import { Feature, Store } from "effect-tca";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const Counter = Feature.make({
  actions: Schema.TaggedUnion({ Incremented: {} }),
  initial: () => ({ count: 0 }),
  reduce: {
    Incremented: (state, _action, effect) => {
      state.count += 1;
      return effect.none;
    },
  },
});

const program = Effect.gen(function* () {
  const store = yield* Store.make(Counter);
  const actions = Store.bindActions(store, Counter.actions);
  yield* actions.Incremented();
  return yield* store.get;
}).pipe(Effect.scoped);
```

Namespace exports are also available as direct imports such as
`effect-tca/Feature`. Effect Atom bindings live in `effect-tca/atom`.
Reuse child descriptors with `Store.scope` or `FeatureAtom.scope` to give each
component only its own state and actions.

Reducers edit temporary drafts and return `effect.none`, `effect.run`, or
`effect.replace`. Async work receives typed action senders; only reducers change
state. Stores serialize actions and start work after committing state. Replacing
work cancels the previous execution for that action tag in the mounted feature.
Disposing the store scope ends its effects and subscriptions. Stores do not
provide persistence or distributed delivery.

See the [guide](https://github.com/danieljvdm/effect-tca/blob/main/docs/GUIDE.md)
and [search example](https://github.com/danieljvdm/effect-tca/tree/main/examples/search).
