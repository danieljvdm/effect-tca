# effect-tca

Composable state and scoped effects for TypeScript, built on Effect.

Features own state, actions, and synchronous reducers. Edit a temporary state
draft, then return an effect. Async work sends actions back through the reducer.

```sh
bun add effect-tca effect
```

Search GitHub repositories as you type. Each new query cancels the previous
search, waits for a pause in typing, and retries transient API failures.

```ts
import { Feature } from "effect-tca";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

const Repositories = Schema.Array(
  Schema.Struct({
    id: Schema.Finite,
    full_name: Schema.String,
    html_url: Schema.String,
  }),
);

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
      // (its delay, fetch, and retries) and create a new one.
      return effect.replace(function* (send) {
        // Clearing the input cancels old work without making another request.
        if (term === "") return;

        // Debounce: newer input cancels this wait and starts a fresh 300 ms.
        yield* Effect.sleep("300 millis");

        const client = (yield* HttpClient.HttpClient).pipe(
          HttpClient.filterStatusOk,
          // Retry this idempotent GET at most twice, with jittered backoff.
          HttpClient.retryTransient({
            schedule: Schedule.exponential("200 millis").pipe(Schedule.jittered),
            times: 2,
          }),
        );

        yield* client
          .get("https://api.github.com/search/repositories", {
            urlParams: { q: term, per_page: 5 },
          })
          .pipe(
            // GitHub does not allow tracing headers on browser requests.
            Effect.provideService(HttpClient.TracerPropagationEnabled, false),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(Schema.Struct({ items: Repositories })),
            ),
            // Async work sends actions; only the reducer edits state.
            Effect.matchEffect({
              onSuccess: ({ items }) => send.ResultsLoaded({ results: items }),
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
`Effect.sleep` supplies the debounce window; `Schedule` controls retries. Both
share the search's scope, and interruption does not send `SearchFailed`.

For React, add `@effect/atom-react`, `react`, and `react-dom` with `bun add`.
Create the binding once, outside render:

```tsx
import { RegistryProvider, useAtomSet, useAtomSuspense } from "@effect/atom-react";
import { FeatureAtom } from "effect-tca/atom";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Atom from "effect/reactivity/Atom";
import { Suspense, useState } from "react";

const search = FeatureAtom.bind(Search, {
  // Supplies the HTTP service; scoped interruption aborts its fetch requests.
  runtime: Atom.runtime(FetchHttpClient.layer),
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

Namespace exports are also available as direct imports such as
`effect-tca/Feature`. Core features and stores work without React; the Atom
adapter lives in `effect-tca/atom`.

See the [guide](https://github.com/danieljvdm/effect-tca/blob/main/docs/GUIDE.md)
for composition and TestStore, and the
[search example](https://github.com/danieljvdm/effect-tca/tree/main/examples/search)
for a complete application.
