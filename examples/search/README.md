# Search example

Fieldnotes is a small React application using `@yielded/tca/atom`.

```sh
vp install
vp run build
vp run --filter tca-search-example dev
```

Open the URL printed by Vite. Search for “travel”, change the query quickly, or
enter a query with no matches. Open a note and start its reading timer. Dismiss
it with Close or Escape, then reopen it: the timer starts fresh.

`Search.ts` defines action schemas, a switch-based search reducer, and an in-memory
SearchApi service. Reducers edit a synchronous state draft and return an effect.
Search waits for a debounce interval and then a simulated API delay.
`effect.replace` cancels the previous QueryChanged execution when a newer query
arrives; named sends carry results back into the reducer. App and Detail use
handler maps under `reduce`. App embeds Search and an optional Detail initialized
with the selected note. Removing Detail cancels its timer Stream automatically.

`App.tsx` creates one Atom runtime and scopes its binding with the same child
descriptors used by `App`. Search and detail components receive only their own
state and actions. Each presented detail gets a new binding; a dismissed detail's
dispatcher cannot target its replacement. Suspense handles initialization and an
error boundary reports failures. The text input keeps its immediate editing draft
local. The RegistryProvider in `main.tsx` owns the store lifetime.
