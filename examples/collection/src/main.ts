import { Store } from "@yielded/tca";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Action, Collection, counters, TickerAction } from "./Collection.ts";

const program = Effect.gen(function* () {
  const store = yield* Store.make(Collection);
  const left = Option.getOrThrow(yield* Store.scope(store, counters.at("left")));
  const right = Option.getOrThrow(yield* Store.scope(store, counters.at("right")));

  yield* left.send(TickerAction.Start());
  yield* right.send(TickerAction.Start());
  yield* Effect.sleep("350 millis");
  yield* Console.log("Two independent tickers:", Object.fromEntries((yield* store.get).counters));
  yield* store.send(Action.Remove({ id: "left" }));
  yield* store.send(Action.Add({ id: "left" }));
  const stale = yield* Effect.flip(left.send(TickerAction.Start()));

  yield* Console.log("The old left handle is rejected:", stale.reason);
  yield* Effect.sleep("250 millis");
  yield* Console.log(
    "Left was recreated; only right keeps ticking:",
    Object.fromEntries((yield* store.get).counters),
  );
}).pipe(Effect.scoped);

await Effect.runPromise(program);
