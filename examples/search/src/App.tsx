import { useAtomSet, useAtomSuspense } from "@effect/atom-react";
import { FeatureAtom } from "@yielded/tca/atom";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import { Suspense, useEffect, useRef, useState } from "react";

import {
  App,
  AppAction,
  DetailAction,
  detailChild,
  type DetailState,
  type Note,
  SearchAction,
  SearchApi,
  searchChild,
  type SearchState,
} from "./Search.ts";

const binding = FeatureAtom.bind(App, { runtime: Atom.runtime(SearchApi.layer) });
const search = FeatureAtom.scope(binding, searchChild);
const details = FeatureAtom.scope(binding, detailChild).pipe(Atom.mapResult(Option.getOrUndefined));

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

function SearchNotes({
  feature,
  onOpen,
}: {
  readonly feature: FeatureAtom.Binding<SearchState, SearchAction>;
  readonly onOpen: (note: Note) => void;
}) {
  const state = useAtomSuspense(feature.state).value;
  const send = useAtomSet(feature.send);

  return (
    <section aria-label="Search notes">
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <SearchInput
          initialQuery={state.query}
          onQueryChange={(query) => send(SearchAction.cases.QueryChanged.make({ query }))}
        />
      </label>
      <div className="results-meta" aria-live="polite">
        <span>
          {state.loading
            ? "Looking through your notes…"
            : `${state.results.length} notes to explore`}
        </span>
        <span>YOUR NOTEBOOK</span>
      </div>
      <div className="notes" aria-busy={state.loading}>
        {state.results.map((note, index) => (
          <button className="note" key={note.id} onClick={() => onOpen(note)}>
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
        {!state.loading && state.results.length === 0 && (
          <p className="empty">No notes found. Try “travel”, “work”, or “everyday”.</p>
        )}
      </div>
    </section>
  );
}

function NoteDetail({
  feature,
  onClose,
}: {
  readonly feature: FeatureAtom.Binding<DetailState, DetailAction>;
  readonly onClose: () => void;
}) {
  const detail = useAtomSuspense(feature.state).value;
  const send = useAtomSet(feature.send);

  return (
    <article>
      <div className="note-top">
        <span className="category">{detail.note.category}</span>
        <button className="close" aria-label="Close note" onClick={onClose}>
          ×
        </button>
      </div>
      <h2 id="note-title">{detail.note.title}</h2>
      <p>{detail.note.body}</p>
      <div className="timer">
        <span>Reading time: {detail.seconds}s</span>
        <button disabled={detail.running} onClick={() => send(DetailAction.cases.Started.make({}))}>
          {detail.running ? "Timer running" : "Start reading timer"}
        </button>
      </div>
    </article>
  );
}

export function Fieldnotes() {
  const detail = useAtomSuspense(details).value;
  const send = useAtomSet(binding.send);
  const dialog = useRef<HTMLDialogElement>(null);

  const isOpen = detail !== undefined;

  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [isOpen]);

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
      <Suspense fallback={<section aria-label="Search notes" aria-busy="true" />}>
        <SearchNotes
          feature={search}
          onOpen={(note) => send(AppAction.cases.Opened.make({ note }))}
        />
      </Suspense>
      <footer>
        <span>A notebook, not a feed.</span>
        <a href="https://github.com/yielded-dev/tca">An Effect TCA example ↗</a>
      </footer>
      <dialog
        ref={dialog}
        aria-labelledby="note-title"
        onCancel={(event) => {
          event.preventDefault();
          send(AppAction.cases.Closed.make({}));
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) send(AppAction.cases.Closed.make({}));
        }}
      >
        {detail !== undefined && (
          <Suspense fallback={null}>
            <NoteDetail feature={detail} onClose={() => send(AppAction.cases.Closed.make({}))} />
          </Suspense>
        )}
      </dialog>
    </main>
  );
}
