import { Store } from "@yielded/tca";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Collection, counters, Ticker } from "./Collection.ts";

const program = Effect.gen(function* () {
  const store = yield* Store.make(Collection);
  const left = Option.getOrThrow(yield* Store.scope(store, counters.at("left")));
  const right = Option.getOrThrow(yield* Store.scope(store, counters.at("right")));
  const actions = Store.bindActions(store, Collection.actions);
  const leftActions = Store.bindActions(left, Ticker.actions);
  const rightActions = Store.bindActions(right, Ticker.actions);

  yield* leftActions.Start();
  yield* rightActions.Start();
  yield* Effect.sleep("350 millis");
  yield* Console.log("Two independent tickers:", Object.fromEntries((yield* store.get).counters));
  yield* actions.Remove({ id: "left" });
  yield* actions.Add({ id: "left" });
  const stale = yield* Effect.flip(leftActions.Start());

  if (stale._tag !== "StoreError") return yield* Effect.fail(stale);

  yield* Console.log("The old left handle is rejected:", stale.reason);
  yield* Effect.sleep("250 millis");
  yield* Console.log(
    "Left was recreated; only right keeps ticking:",
    Object.fromEntries((yield* store.get).counters),
  );
}).pipe(Effect.scoped);

await Effect.runPromise(program);
