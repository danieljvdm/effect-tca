# Effect TCA

Composable state and scoped effects for TypeScript, built on Effect.

A feature owns immutable state, actions, and a synchronous reducer. Reducers
edit temporary state drafts and return scoped Effect work that sends actions
back to the store.
Features compose into larger features, and child lifetimes cancel their work when they disappear.
The same child descriptors scope stores and Atom bindings for reusable views.

```ts
import { Feature, Store } from "@yielded/tca";
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

Install with `bun add @yielded/tca effect`. Package manifests own compatibility.
The [search example](examples/search/README.md) is a complete React application
with debounced search, child composition, and a reading timer that ends when its
detail is dismissed. [The guide](docs/GUIDE.md) covers effects, composition,
Atom bindings, and TestStore.

## Development

```sh
vp install
vp run build
vp run --filter tca-search-example dev
vp run ready
```

Library code lives in `packages/tca`; applications live in `examples`.
The [toolchain guide](docs/TOOLCHAIN.md) describes commands and repository rules.
The [public contracts](docs/PUBLIC_API.md) describe ownership and limitations.

Inspired by Point-Free's [Composable Architecture](https://github.com/pointfreeco/swift-composable-architecture).
Repository tooling and pinned contributor skills follow
[`yielded-dev/sync`](https://github.com/yielded-dev/sync/tree/cfae88bdd717e5c82b82ddf0592e1337816eabb8).
