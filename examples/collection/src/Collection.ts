import { Feature } from "@yielded/tca";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export const TickerAction = Schema.TaggedUnion({ Start: {}, Tick: {} });

export type TickerAction = typeof TickerAction.Type;

export interface TickerState {
  readonly count: number;
}

export const Ticker = Feature.make({
  actions: TickerAction,
  initial: (): TickerState => ({ count: 0 }),
  reduce: {
    Start: (_state, _action, effect) =>
      effect.replace(function* (send) {
        yield* Stream.tick("100 millis").pipe(
          Stream.drop(1),
          Stream.runForEach(() => send.Tick()),
        );
      }),
    Tick: (state, _action, effect) => {
      state.count++;

      return effect.none;
    },
  },
});

export interface State {
  readonly counters: ReadonlyMap<string, TickerState>;
}

export const Action = Schema.TaggedUnion({
  Counter: { action: Schema.Struct({ id: Schema.String, action: TickerAction }) },
  Remove: { id: Schema.String },
  Add: { id: Schema.String },
});

export type Action = typeof Action.Type;

export const counters = Feature.forEach<State, Action>()({
  state: "counters",
  action: "Counter",
  feature: Ticker,
});

export const Collection = Feature.make({
  actions: Action,
  initial: (): State => ({
    counters: new Map([
      ["left", Ticker.initial()],
      ["right", Ticker.initial()],
    ]),
  }),
  reduce: {
    Counter: (_state, _action, effect) => effect.none,
    Remove: (state, { id }, effect) => {
      state.counters.delete(id);

      return effect.none;
    },
    Add: (state, { id }, effect) => {
      if (!state.counters.has(id)) state.counters.set(id, Ticker.initial());

      return effect.none;
    },
  },
}).pipe(counters);
