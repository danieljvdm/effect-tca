import { Feature } from "effect-tca";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export const Note = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  category: Schema.String,
  body: Schema.String,
});

export type Note = typeof Note.Type;

export const notes: readonly [Note, ...Note[]] = [
  {
    id: "coast",
    title: "A morning by the coast",
    category: "Travel",
    body: "The best route is the one with time to stop. Salt air, a quiet path, and coffee overlooking the water.",
  },
  {
    id: "garden",
    title: "What the garden teaches",
    category: "Everyday",
    body: "Small things, tended regularly. The tomatoes are finally ripening, and the afternoon light stays a little longer.",
  },
  {
    id: "making",
    title: "On making things",
    category: "Work",
    body: "Start with something you can hold in your head. Make the pieces clear, then let them grow together.",
  },
  {
    id: "mountains",
    title: "A weekend in the mountains",
    category: "Travel",
    body: "We took the long way home. Pine trees, cool water, and a notebook full of places to return to.",
  },
  {
    id: "reading",
    title: "A place for slow reading",
    category: "Everyday",
    body: "A good chair and an open window. A few pages at a time is still a way through a book.",
  },
  {
    id: "attention",
    title: "The shape of attention",
    category: "Work",
    body: "Leave room between tasks. A clear desk can help, but a clear next step helps more.",
  },
];

export class SearchApi extends Context.Service<
  SearchApi,
  {
    readonly search: (query: string) => Effect.Effect<ReadonlyArray<Note>>;
  }
>()("tca-search-example/SearchApi") {
  static readonly layer = Layer.succeed(SearchApi, {
    search: (query) =>
      Effect.sleep("400 millis").pipe(
        Effect.as(
          notes.filter((note) =>
            `${note.title} ${note.category} ${note.body}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          ),
        ),
      ),
  });
}

export interface SearchState {
  readonly query: string;
  readonly loading: boolean;
  readonly results: ReadonlyArray<Note>;
}

export const SearchAction = Schema.TaggedUnion({
  QueryChanged: { query: Schema.String },
  ResultsLoaded: { results: Schema.Array(Note) },
});

export type SearchAction = typeof SearchAction.Type;

export const Search = Feature.make({
  actions: SearchAction,
  initial: (): SearchState => ({ query: "", loading: false, results: notes }),
  reduce: (state, action, effect) => {
    switch (action._tag) {
      case "QueryChanged": {
        const { query } = action;

        state.query = query;
        state.loading = true;

        return effect.replace(function* (send) {
          yield* Effect.sleep("250 millis");
          const searchApi = yield* SearchApi;
          const results = yield* searchApi.search(query);

          yield* send.ResultsLoaded({ results });
        });
      }
      case "ResultsLoaded": {
        state.results = [...action.results];
        state.loading = false;

        return effect.none;
      }
    }
  },
});

export interface DetailState {
  readonly note: Note;
  readonly seconds: number;
  readonly running: boolean;
}

export const DetailAction = Schema.TaggedUnion({ Started: {}, Tick: {} });

export type DetailAction = typeof DetailAction.Type;

export const Detail = Feature.make({
  actions: DetailAction,
  initial: (note: Note): DetailState => ({ note, seconds: 0, running: false }),
  reduce: {
    Started: (state, _action, effect) => {
      if (state.running) return effect.none;
      state.running = true;

      return effect.run(function* (send) {
        yield* Stream.tick("1 second").pipe(
          Stream.drop(1),
          Stream.runForEach(() => send.Tick()),
        );
      });
    },
    Tick: (state, _action, effect) => {
      state.seconds++;

      return effect.none;
    },
  },
});

export interface AppState {
  readonly search: SearchState;
  readonly detail: Option.Option<DetailState>;
}

export const AppAction = Schema.TaggedUnion({
  Search: { action: SearchAction },
  Detail: { action: DetailAction },
  Opened: { note: Note },
  Closed: {},
});

export type AppAction = typeof AppAction.Type;

export const searchChild = Feature.child<AppState, AppAction>()({
  state: "search",
  action: "Search",
  feature: Search,
});

export const detailChild = Feature.optionalChild<AppState, AppAction>()({
  state: "detail",
  action: "Detail",
  feature: Detail,
  identity: (state) => state.note.id,
});

export const App = Feature.make({
  actions: AppAction,
  initial: (): AppState => ({ search: Search.initial(), detail: Option.none() }),
  reduce: {
    Search: (_state, _action, effect) => effect.none,
    Detail: (_state, _action, effect) => effect.none,
    Opened: (state, { note }, effect) => {
      if (Option.isSome(state.detail) && state.detail.value.note.id === note.id) return effect.none;
      state.detail = Option.some(Detail.initial(note));

      return effect.none;
    },
    Closed: (state, _action, effect) => {
      state.detail = Option.none();

      return effect.none;
    },
  },
}).pipe(searchChild, detailChild);
