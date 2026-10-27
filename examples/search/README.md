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

`Search.ts` owns the application features and an in-memory SearchApi service.
Search waits for a debounce interval and then a simulated API delay. A newer
query invalidates the previous command. `App` embeds Search and an optional
Detail feature, initialized with the selected note. Removing Detail cancels its
timer automatically.

`App.tsx` creates one Atom runtime and scopes its binding with the same child
descriptors used by `App`. Search and detail components receive only their own
state and actions. Each presented detail gets a new binding; a dismissed detail's
dispatcher cannot target its replacement. The text input keeps its immediate
editing draft local. The RegistryProvider in `main.tsx` owns the store lifetime.
