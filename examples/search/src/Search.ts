import { Command, Feature } from "@yielded/tca";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Optic from "effect/Optic";
import * as Option from "effect/Option";

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly body: string;
}

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

export type SearchAction = Data.TaggedEnum<{
  QueryChanged: { readonly query: string };
  ResultsLoaded: { readonly results: ReadonlyArray<Note> };
}>;

export const SearchAction = Data.taggedEnum<SearchAction>();

export const Search = Feature.make<SearchState, SearchAction>()({
  initial: () => ({ query: "", loading: false, results: notes }),
  reduce: (state, action) =>
    SearchAction.$match(action, {
      QueryChanged: ({ query }) => ({
        state: { ...state, query, loading: true },
        commands: [
          Command.latest("search", (send: Command.Send<SearchAction>) =>
            Effect.gen(function* () {
              yield* Effect.sleep("250 millis");
              const api = yield* SearchApi;
              const results = yield* api.search(query);

              yield* send(SearchAction.ResultsLoaded({ results }));
            }),
          ),
        ],
      }),
      ResultsLoaded: ({ results }) => ({ state: { ...state, results, loading: false } }),
    }),
});

export interface DetailState {
  readonly note: Note;
  readonly seconds: number;
  readonly running: boolean;
}

export type DetailAction = Data.TaggedEnum<{ Started: {}; Tick: {} }>;
export const DetailAction = Data.taggedEnum<DetailAction>();

export const Detail = Feature.make<DetailState, DetailAction>()({
  initial: () => ({ note: notes[0], seconds: 0, running: false }),
  reduce: (state, action) =>
    DetailAction.$match(action, {
      Started: () => ({
        state: { ...state, running: true },
        commands: [
          Command.latest("timer", (send: Command.Send<DetailAction>) =>
            Effect.forever(
              Effect.sleep("1 second").pipe(Effect.andThen(send(DetailAction.Tick()))),
            ),
          ),
        ],
      }),
      Tick: () => ({ state: { ...state, seconds: state.seconds + 1 } }),
    }),
});

export interface AppState {
  readonly search: SearchState;
  readonly detail: Option.Option<DetailState>;
}

export type AppAction = Data.TaggedEnum<{
  Search: { readonly action: SearchAction };
  Detail: { readonly action: DetailAction };
  Opened: { readonly note: Note };
  Closed: {};
}>;

export const AppAction = Data.taggedEnum<AppAction>();

export const App = Feature.make<AppState, AppAction>()({
  initial: () => ({ search: Search.initial(), detail: Option.none() }),
  reduce: (state, action) =>
    AppAction.$match(action, {
      Search: () => ({ state }),
      Detail: () => ({ state }),
      Opened: ({ note }) => ({
        state: { ...state, detail: Option.some({ note, seconds: 0, running: false }) },
      }),
      Closed: () => ({ state: { ...state, detail: Option.none() } }),
    }),
}).pipe(
  Feature.child({
    state: Optic.id<AppState>().key("search"),
    action: Feature.tag<AppAction>()("Search"),
    feature: Search,
  }),
  Feature.optionalChild({
    state: Optic.id<AppState>().key("detail"),
    action: Feature.tag<AppAction>()("Detail"),
    feature: Detail,
    identity: (state) => state.note.id,
  }),
);
