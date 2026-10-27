# @yielded/tca

Immutable feature reducers, scoped Effect commands, typed child composition,
and a TestStore for complete action and state assertions.

```sh
bun add @yielded/tca effect
```

```ts
import { Feature, Store } from "@yielded/tca";
import * as Effect from "effect/Effect";

const Counter = Feature.make<number, "increment">()({
  initial: () => 0,
  reduce: (state) => ({ state: state + 1 }),
});

const program = Effect.gen(function* () {
  const store = yield* Store.make(Counter);
  yield* store.send("increment");
  return yield* store.get;
}).pipe(Effect.scoped);
```

Namespace exports are also available as direct imports such as
`@yielded/tca/Feature`. Effect Atom bindings live in `@yielded/tca/atom`.
Reuse child descriptors with `Store.scope` or `FeatureAtom.scope` to give each
component only its own state and actions.

Commands never write state directly. Stores serialize actions and run commands
after committing state. Disposing the store scope ends its commands and
subscriptions. Stores do not provide persistence or distributed delivery.

See the [guide](https://github.com/yielded-dev/tca/blob/main/docs/GUIDE.md)
and [search example](https://github.com/yielded-dev/tca/tree/main/examples/search).
