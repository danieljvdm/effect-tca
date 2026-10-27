import { Store } from "@yielded/tca";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import { Action, Collection, TickerAction } from "./Collection.ts";

const program = Effect.gen(function* () {
  const store = yield* Store.make(Collection);

  yield* store.send(Action.Counter({ action: { id: "left", action: TickerAction.Start() } }));
  yield* store.send(Action.Counter({ action: { id: "right", action: TickerAction.Start() } }));
  yield* Effect.sleep("350 millis");
  yield* Console.log("Two independent tickers:", Object.fromEntries((yield* store.get).counters));
  yield* store.send(Action.Remove({ id: "left" }));
  yield* store.send(Action.Add({ id: "left" }));
  yield* Effect.sleep("250 millis");
  yield* Console.log(
    "Left was recreated; only right keeps ticking:",
    Object.fromEntries((yield* store.get).counters),
  );
}).pipe(Effect.scoped);

await Effect.runPromise(program);
