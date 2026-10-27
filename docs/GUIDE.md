# Building a feature

Define immutable state and actions, then return the next state from a synchronous
reducer. A feature definition can create many independent stores. Each store's
scope owns its work and subscriptions.

```ts
import { Command, Feature, Store } from "@yielded/tca";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

type State = { readonly seconds: number; readonly running: boolean };
type Action = Data.TaggedEnum<{ Start: {}; Stop: {}; Tick: {} }>;
const Action = Data.taggedEnum<Action>();

const Timer = Feature.make<State, Action>()({
  initial: () => ({ seconds: 0, running: false }),
  reduce: (state, action) =>
    Action.$match(action, {
      Start: () => ({
        state: { ...state, running: true },
        commands: [
          Command.latest("timer", (send: Command.Send<Action>) =>
            Effect.forever(Effect.sleep("1 second").pipe(Effect.andThen(send(Action.Tick())))),
          ),
        ],
      }),
      Stop: () => ({
        state: { ...state, running: false },
        commands: [Command.cancel("timer")],
      }),
      Tick: () => ({ state: { ...state, seconds: state.seconds + 1 } }),
    }),
});
```

`Command.run` starts independent work. `Command.latest` replaces work with the
same key in that feature instance. Both receive an effectful `send` function.
Yield it to send an action and wait for its state transition. Use ordinary
Effect services inside commands; provide their Layers when creating a store.
Handle expected service failures by sending an application action.

```ts
const program = Effect.gen(function* () {
  const store = yield* Store.make(Timer);
  yield* store.send(Action.Start());
  yield* Effect.sleep("2 seconds");
  yield* store.send(Action.Stop());
  return yield* store.get;
}).pipe(Effect.scoped);
```

Store snapshots are immutable. `changes` starts with the current state and
publishes new snapshots, coalescing updates for slow observers. `send` completes
after the transition commits and its commands are registered. It does not wait
for the timer to finish. Unexpected reducer or command failures close the store;
observe `closed` when hosting a store outside its normal UI lifetime.

## Composing children

Use an Effect optic for the child's state and an explicit action route:

```ts
import * as Optic from "effect/Optic";

type ParentState = { readonly timer: State };
type ParentAction = Data.TaggedEnum<{ Timer: { readonly action: Action } }>;

const Parent = Feature.make<ParentState, ParentAction>()({
  initial: () => ({ timer: Timer.initial() }),
  reduce: (state) => ({ state }),
}).pipe(
  Feature.child({
    state: Optic.id<ParentState>().key("timer"),
    action: Feature.tag<ParentAction>()("Timer"),
    feature: Timer,
  }),
);
```

The child processes its action before the parent. Its emitted actions are mapped
back through the same route. `Feature.tag` accepts cases with exactly `_tag` and
`action`; other shapes use a `Feature.Route` with `key`, `extract`, and `embed`.
Route keys must be unique within a parent.

Use `Feature.optionalChild` for `Option<ChildState>`. Setting it to `None` ends
the child's work. Supply `identity` when replacing a present child should also
end its old lifetime. Reopening after removal always creates a fresh lifetime.

Use `Feature.forEach` for a `ReadonlyMap<string, ChildState>`. Its route carries
`{ id, action }`; each map key identifies a separate child. Replace maps instead
of mutating them. Removing a key cancels only that child's work. See the
[collection example](../examples/collection/README.md).

## React and Atom

Create a binding once, outside render, using the application's Atom runtime:

```ts
import { FeatureAtom } from "@yielded/tca/atom";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

const timer = FeatureAtom.bind(Timer, {
  runtime: Atom.runtime(Layer.empty),
});
```

Inside a RegistryProvider, `useAtomValue(timer.state)` returns an AsyncResult and
`useAtomSet(timer.send)` returns a dispatcher. Handle Initial, Success, and
Failure in the view. The binding creates one store per registry. Releasing its
last subscriber and action mount disposes that store; keep a subscription at
the desired application lifetime. Derived atoms can select smaller state slices.
Dispatch is asynchronous; keep controlled text-input drafts local so typing is
reflected immediately, and send their values as feature actions.

The [search application](../examples/search/README.md) shows the complete setup.

## TestStore

Supply the test runner's deep-equality assertion. TestStore holds command actions
until you receive them, using the same reducer and command runtime as Store.

```ts
import assert from "node:assert/strict";

import { TestStore } from "@yielded/tca";
import * as TestClock from "effect/testing/TestClock";

const scenario = Effect.gen(function* () {
  const store = yield* TestStore.make(Timer, {
    assertEquals: assert.deepStrictEqual,
  });
  yield* store.send(Action.Start(), (state) => ({ ...state, running: true }));
  yield* TestClock.adjust("1 second");
  yield* store.receive(Action.Tick(), (state) => ({ ...state, seconds: 1 }));
  yield* store.send(Action.Stop(), (state) => ({ ...state, running: false }));
  yield* store.finish;
}).pipe(Effect.scoped, Effect.provide(TestClock.layer()));
```

Each callback returns the complete expected next state. Omitting it asserts no
state change. Receive pending effect actions before sending more user actions.
`finish` checks for pending emissions and unfinished commands; cancel long-lived
work explicitly first. Receive timeouts use the current Effect clock, so with
TestClock you must advance time and retain the runner's overall wall timeout.
