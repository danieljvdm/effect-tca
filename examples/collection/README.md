# Keyed children

Two tickers share a feature definition and a local command key. Each map entry
has its own lifetime, so they run independently. Removing and recreating the
left entry cancels its old work while the right entry continues.

```sh
vp install
vp run build
vp run --filter tca-collection-example start
```

`Collection.ts` defines the reusable feature. `main.ts` runs it in a scoped store
and uses `Store.scope(store, counters.at(id))` to send each child its own actions.
It prints two snapshots and shows that the old left handle rejects dispatch after
recreation. Scope the parent again to obtain a new handle. Scope exit releases
the remaining ticker.
