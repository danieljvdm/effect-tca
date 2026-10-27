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
and prints the two snapshots. Scope exit releases the remaining ticker.
