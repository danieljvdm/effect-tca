# effect-tca

Composable state and scoped effects for TypeScript, built on Effect.

Features own state, actions, and synchronous reducers. Edit a temporary state
draft, then return an effect. Async work sends actions back through the reducer.

```sh
bun add effect-tca effect
```

An editor keeps its draft and save/cancel transitions in a feature. Effect Atom
owns the saved document, query status, and cache invalidation. The draft is an
intentional snapshot: a background refresh must not overwrite someone's edits.

Assume `./data` exports a `DocumentWriter` Effect service contract with
`save({ id, body })`, a `documentAtom(id)` query, and a `saveDocument` mutation.
The mutation updates the document and invalidates its query on success.

```ts
import { Feature } from "effect-tca";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DocumentWriter } from "./data";

const Editor = Feature.make({
  actions: Schema.TaggedUnion({
    Opened: { id: Schema.String, body: Schema.String },
    BodyChanged: { body: Schema.String },
    SaveClicked: {},
    Saved: {},
    SaveFailed: {},
    CancelClicked: {},
  }),
  initial: () => ({ id: "", draft: "", editing: false, saving: false, error: "" }),
  reduce: {
    Opened: (state, { id, body }, effect) => {
      if (state.editing) return effect.none;
      state.id = id;
      state.draft = body;
      state.editing = true;
      state.error = "";
      return effect.none;
    },
    BodyChanged: (state, { body }, effect) => {
      if (state.editing && !state.saving) state.draft = body;
      return effect.none;
    },
    SaveClicked: (state, _action, effect) => {
      // Repeated clicks cannot start a second save.
      if (!state.editing || state.saving) return effect.none;
      state.saving = true;
      state.error = "";
      const document = { id: state.id, body: state.draft };

      // Capture values now; async work never holds the mutable state draft.
      return effect.run(function* (send) {
        const writer = yield* DocumentWriter;
        yield* writer.save(document).pipe(
          Effect.matchEffect({
            onSuccess: () => send.Saved(),
            onFailure: () => send.SaveFailed(),
          }),
        );
      });
    },
    Saved: (state, _action, effect) => {
      state.saving = false;
      state.editing = false;
      state.draft = "";
      return effect.none;
    },
    SaveFailed: (state, _action, effect) => {
      state.saving = false;
      state.error = "Couldn't save. Your draft is still here.";
      return effect.none;
    },
    CancelClicked: (state, _action, effect) => {
      if (state.saving) return effect.none;
      state.editing = false;
      state.draft = "";
      state.error = "";
      return effect.none;
    },
  },
});
```

The application connects the feature's dependency to its existing Atom mutation.
`get.setResult` runs that mutation and awaits its result in the same registry.
The feature receives a completion action; the query remains the source of saved
content. The binding and mutation below serve one editor; give concurrent
editors separate mutation atoms.

```tsx
import { useAtomSet, useAtomSuspense } from "@effect/atom-react";
import { FeatureAtom } from "effect-tca/atom";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

import { documentAtom, saveDocument } from "./data";

const editor = FeatureAtom.bind(Editor, {
  runtime: Atom.runtime((get) =>
    Layer.succeed(DocumentWriter, {
      // The existing mutation owns the write and query invalidation.
      save: (document) => Effect.suspend(() => get.setResult(saveDocument, document)),
    }),
  ),
});

export function DocumentEditor() {
  const document = useAtomSuspense(documentAtom("welcome")).value;
  const state = useAtomSuspense(editor.state).value;
  const send = useAtomSet(editor.send);

  if (!state.editing) {
    return (
      <article>
        <p>{document.body}</p>
        <button onClick={() => send({ _tag: "Opened", id: document.id, body: document.body })}>
          Edit
        </button>
      </article>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send({ _tag: "SaveClicked" });
      }}
    >
      {/* The browser keeps typing immediate while draft actions are queued. */}
      <textarea
        defaultValue={state.draft}
        aria-label="Document body"
        disabled={state.saving}
        onChange={(event) => send({ _tag: "BodyChanged", body: event.currentTarget.value })}
      />
      {state.error && <p role="alert">{state.error}</p>}
      <button disabled={state.saving}>{state.saving ? "Saving…" : "Save"}</button>
      <button type="button" disabled={state.saving} onClick={() => send({ _tag: "CancelClicked" })}>
        Cancel
      </button>
    </form>
  );
}
```

For React, add `@effect/atom-react`, `react`, and `react-dom` with `bun add`.
Render inside `RegistryProvider`, `Suspense`, and an error boundary. Create
bindings and query/mutation atoms outside render; share the query and mutation's
Atom runtime factory so invalidation reaches the same data.

Releasing the last feature consumer disposes its store and stops its effects.
That releases the feature's wait for a mutation; it does not guarantee that a
server write is undone. Cancel here discards an unsaved draft and is disabled
during saving. Shared query lifetimes remain under Atom's control.

Namespace exports are also available as direct imports such as
`effect-tca/Feature`. Core features and stores work without React; the Atom
adapter lives in `effect-tca/atom`.

See the [guide](https://github.com/danieljvdm/effect-tca/blob/main/docs/GUIDE.md)
for composition and TestStore, and the
[search example](https://github.com/danieljvdm/effect-tca/tree/main/examples/search)
for a complete application.
