# Effect TCA

Composable state and scoped effects for TypeScript, built on Effect.

Features own state, actions, and synchronous reducers. Edit a temporary state
draft, then return an effect. Async work sends actions back through the reducer.

```sh
bun add effect-tca effect
```

Search repositories as you type. Each new query replaces the previous search.
Assume `./api` exports a `Repository` schema and a `SearchApi` service whose
read-only `search(query)` effect handles HTTP, decoding, and interruption.
Its errors expose `retryable` to distinguish transient failures.

```ts
import { Feature } from "effect-tca";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { Repository, SearchApi } from "./api";

const Repositories = Schema.Array(Repository);

const Search = Feature.make({
  actions: Schema.TaggedUnion({
    QueryChanged: { query: Schema.String },
    ResultsLoaded: { results: Repositories },
    SearchFailed: {},
  }),
  initial: () => ({
    query: "",
    results: Repositories.make([]),
    loading: false,
    error: "",
  }),
  reduce: {
    QueryChanged: (state, { query }, effect) => {
      const term = query.trim();
      // Repeated queries leave the current search alone.
      if (term === state.query) return effect.none;
      state.query = term;
      state.results = [];
      state.error = "";
      state.loading = term.length > 0;

      // After committing state, cancel the previous QueryChanged scope
      // (its delay, request, and retries) and create a new one.
      return effect.replace(function* (send) {
        // Clearing the input cancels old work without making another request.
        if (term === "") return;

        const api = yield* SearchApi;
        yield* api.search(term).pipe(
          // Retry transient failures up to twice using a native Effect schedule.
          Effect.retry({
            schedule: Schedule.exponential("200 millis"),
            times: 2,
            while: (error) => error.retryable,
          }),
          // Debounce: replacing this scope cancels the wait and any running work.
          Effect.delay("300 millis"),
          // Async work sends actions; only the reducer edits state.
          Effect.matchEffect({
            onSuccess: (results) => send.ResultsLoaded({ results }),
            onFailure: () => send.SearchFailed(),
          }),
        );
      });
    },
    ResultsLoaded: (state, { results }, effect) => {
      state.results = [...results];
      state.loading = false;
      return effect.none;
    },
    SearchFailed: (state, _action, effect) => {
      state.loading = false;
      state.error = "Search failed. Try a different query.";
      return effect.none;
    },
  },
});
```

`effect.replace` uses the current action tag as its key, local to this feature
instance. A replaced search cannot send stale results into the new one.
`Effect.delay` supplies the debounce window; `Schedule` controls retries. Both
share the search's scope, and interruption does not send `SearchFailed`.

For React, add `@effect/atom-react`, `react`, and `react-dom` with `bun add`.
Create the binding once, outside render:

```tsx
import { RegistryProvider, useAtomSet, useAtomSuspense } from "@effect/atom-react";
import { FeatureAtom } from "effect-tca/atom";
import * as Atom from "effect/reactivity/Atom";
import { Suspense, useState } from "react";

const search = FeatureAtom.bind(Search, {
  runtime: Atom.runtime(SearchApi.layer),
});

function RepositorySearch() {
  const result = useAtomSuspense(search.state, { includeFailure: true });
  const send = useAtomSet(search.send);
  // Keep typing immediate while actions flow through the store asynchronously.
  const [input, setInput] = useState("");

  if (result._tag === "Failure") {
    return <p role="alert">The search stopped unexpectedly.</p>;
  }

  const state = result.value;

  return (
    <section>
      <h1>Find a repository</h1>
      <input
        aria-label="Search GitHub repositories"
        placeholder="effect-tca"
        value={input}
        onChange={(event) => {
          const query = event.currentTarget.value;
          setInput(query);
          send({ _tag: "QueryChanged", query });
        }}
      />
      {state.loading && <p role="status">Searching…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      <ul>
        {state.results.map((repo) => (
          <li key={repo.id}>
            <a href={repo.html_url}>{repo.full_name}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function App() {
  return (
    <RegistryProvider>
      <Suspense fallback={<p>Opening search…</p>}>
        <RepositorySearch />
      </Suspense>
    </RegistryProvider>
  );
}
```

The Atom binding gives each registry its own store. Releasing the last consumer
disposes the store and cancels its work. Removing a composed child feature does
the same for that child, without affecting other instances.

The [guide](docs/GUIDE.md) covers composition, scoped stores, and TestStore.
The [search example](examples/search/README.md) shows a complete React app with
service dependencies, debounced search, and an optional detail feature.

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
