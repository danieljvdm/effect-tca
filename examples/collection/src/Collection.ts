import { Command, Feature } from "@yielded/tca";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Optic from "effect/Optic";

export type TickerAction = Data.TaggedEnum<{ Start: {}; Tick: {} }>;
export const TickerAction = Data.taggedEnum<TickerAction>();

export const Ticker = Feature.make<number, TickerAction>()({
  initial: () => 0,
  reduce: (state, action) =>
    TickerAction.$match(action, {
      Start: () => ({
        state,
        commands: [
          Command.latest("tick", (send: Command.Send<TickerAction>) =>
            Effect.forever(
              Effect.sleep("100 millis").pipe(Effect.andThen(send(TickerAction.Tick()))),
            ),
          ),
        ],
      }),
      Tick: () => ({ state: state + 1 }),
    }),
});

export interface State {
  readonly counters: ReadonlyMap<string, number>;
}

export type Action = Data.TaggedEnum<{
  Counter: { readonly action: Feature.Identified<TickerAction> };
  Remove: { readonly id: string };
  Add: { readonly id: string };
}>;

export const Action = Data.taggedEnum<Action>();

export const Collection = Feature.make<State, Action>()({
  initial: () => ({
    counters: new Map([
      ["left", 0],
      ["right", 0],
    ]),
  }),
  reduce: (state, action) =>
    Action.$match(action, {
      Counter: () => ({ state }),
      Remove: ({ id }) => {
        const counters = new Map(state.counters);

        counters.delete(id);

        return { state: { counters } };
      },
      Add: ({ id }) => {
        const counters = new Map(state.counters);

        if (!counters.has(id)) counters.set(id, 0);

        return { state: { counters } };
      },
    }),
}).pipe(
  Feature.forEach({
    state: Optic.id<State>().key("counters"),
    action: Feature.tag<Action>()("Counter"),
    feature: Ticker,
  }),
);
