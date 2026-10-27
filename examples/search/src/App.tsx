import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { FeatureAtom } from "@yielded/tca/atom";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useRef, useState } from "react";

import { App, AppAction, DetailAction, SearchAction, SearchApi } from "./Search.ts";

const binding = FeatureAtom.bind(App, { runtime: Atom.runtime(SearchApi.layer) });

function SearchInput({
  initialQuery,
  onQueryChange,
}: {
  readonly initialQuery: string;
  readonly onQueryChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState(initialQuery);

  return (
    <input
      aria-label="Search your notes"
      type="search"
      placeholder="Find a thought, a place, a moment…"
      value={draft}
      onChange={(event) => {
        const query = event.target.value;

        setDraft(query);
        onQueryChange(query);
      }}
    />
  );
}

export function Fieldnotes() {
  const result = useAtomValue(binding.state);
  const send = useAtomSet(binding.send);
  const dialog = useRef<HTMLDialogElement>(null);
  const state = result._tag === "Success" ? result.value : undefined;
  const detail = state === undefined ? undefined : Option.getOrUndefined(state.detail);

  const isOpen = detail !== undefined;

  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [isOpen]);

  if (result._tag === "Failure")
    return (
      <main>
        <h1>Something went wrong</h1>
        <p>Please reload to start a fresh session.</p>
      </main>
    );
  if (state === undefined)
    return (
      <main aria-busy="true">
        <p>Opening your notebook…</p>
      </main>
    );

  return (
    <main>
      <header className="masthead">
        <a href="./" aria-label="Fieldnotes home">
          <span className="mark">f.</span> FIELDNOTES
        </a>
        <span className="edition">A SMALL COLLECTION</span>
      </header>
      <section className="intro">
        <span className="eyebrow">THINGS WORTH KEEPING</span>
        <h1>
          A little room
          <br />
          for good ideas.
        </h1>
        <p>Notes from work, the everyday, and the long way home.</p>
      </section>
      <section aria-label="Search notes">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <SearchInput
            initialQuery={state.search.query}
            onQueryChange={(query) =>
              send(
                AppAction.Search({
                  action: SearchAction.QueryChanged({ query }),
                }),
              )
            }
          />
        </label>
        <div className="results-meta" aria-live="polite">
          <span>
            {state.search.loading
              ? "Looking through your notes…"
              : `${state.search.results.length} notes to explore`}
          </span>
          <span>YOUR NOTEBOOK</span>
        </div>
        <div className="notes" aria-busy={state.search.loading}>
          {state.search.results.map((note, index) => (
            <button className="note" key={note.id} onClick={() => send(AppAction.Opened({ note }))}>
              <div className="note-top">
                <span className="category">{note.category}</span>
                <span className="number">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h2>{note.title}</h2>
              <p>{note.body}</p>
              <span className="read">
                Read note <span aria-hidden="true">↗</span>
              </span>
            </button>
          ))}
          {!state.search.loading && state.search.results.length === 0 && (
            <p className="empty">No notes found. Try “travel”, “work”, or “everyday”.</p>
          )}
        </div>
      </section>
      <footer>
        <span>A notebook, not a feed.</span>
        <a href="https://github.com/yielded-dev/tca">An Effect TCA example ↗</a>
      </footer>
      <dialog
        ref={dialog}
        aria-labelledby="note-title"
        onCancel={(event) => {
          event.preventDefault();
          send(AppAction.Closed());
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) send(AppAction.Closed());
        }}
      >
        {detail !== undefined && (
          <article>
            <div className="note-top">
              <span className="category">{detail.note.category}</span>
              <button
                className="close"
                aria-label="Close note"
                onClick={() => send(AppAction.Closed())}
              >
                ×
              </button>
            </div>
            <h2 id="note-title">{detail.note.title}</h2>
            <p>{detail.note.body}</p>
            <div className="timer">
              <span>Reading time: {detail.seconds}s</span>
              <button
                disabled={detail.running}
                onClick={() => send(AppAction.Detail({ action: DetailAction.Started() }))}
              >
                {detail.running ? "Timer running" : "Start reading timer"}
              </button>
            </div>
          </article>
        )}
      </dialog>
    </main>
  );
}
