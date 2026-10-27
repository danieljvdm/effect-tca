# Keyed children

Two tickers share a feature definition. Each map entry has its own lifetime, so
they run independently. Removing and recreating the left entry cancels its old
work while the right entry continues.

```sh
vp install
vp run build
vp run --filter tca-collection-example start
```

`Collection.ts` defines actions with `Schema.TaggedUnion`, handles them with an
exhaustive `reduce` map, and sends ticks from a Stream. Handlers edit synchronous
state drafts and return `effect.none` or an execution. Calling Start replaces that
child's previous Start execution with `effect.replace`, without a cancellation key.
`main.ts` runs it in a scoped store and uses `Store.scope(store, counters.at(id))`
to give each child its own actions. `Store.bindActions` derives payload-taking senders from the
feature's action schema and validates inputs inside the returned Effect.
It prints two snapshots and shows that the old left handle rejects dispatch after
recreation. Scope the parent again to obtain a new handle. Scope exit releases
the remaining ticker.
