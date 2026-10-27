import { Command, Feature } from "@yielded/tca";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export const TickerAction = Schema.TaggedUnion({ Start: {}, Tick: {} });

export type TickerAction = typeof TickerAction.Type;

export const Ticker = Feature.make({
  actions: TickerAction,
  initial: () => 0,
  cases: {
    Start: (state) => ({
      state,
      effects: [
        Stream.tick("100 millis").pipe(
          Stream.drop(1),
          Stream.map(() => TickerAction.cases.Tick.make({})),
          Command.latest("tick"),
        ),
      ],
    }),
    Tick: (state) => ({ state: state + 1 }),
  },
});

export interface State {
  readonly counters: ReadonlyMap<string, number>;
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
      ["left", 0],
      ["right", 0],
    ]),
  }),
  cases: {
    Counter: (state) => ({ state }),
    Remove: (state, { id }) => {
      const counters = new Map(state.counters);

      counters.delete(id);

      return { state: { counters } };
    },
    Add: (state, { id }) => {
      const counters = new Map(state.counters);

      if (!counters.has(id)) counters.set(id, 0);

      return { state: { counters } };
    },
  },
}).pipe(counters);
