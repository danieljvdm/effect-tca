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
same key in that feature instance. For one response, pass an Effect returning
an action; the command sends its result automatically. For multiple emissions,
use the callback form above and yield `send` to wait for each state transition.
Use ordinary Effect services inside commands and provide their Layers when
creating a store. Convert expected service failures into application actions.

```ts
const program = Effect.gen(function* () {
  const store = yield* Store.make(Timer);
  yield* store.send(Action.Start());
  yield* Effect.sleep("2 seconds");
  yield* store.send(Action.Stop());
  return yield* store.get;
}).pipe(Effect.scoped);
```

An initializer can require data, such as `initial: (note: Note) => ...`.
Create that store with `{ input: note }`, or supply `{ initialState }` directly.
Parents initialize children with `Detail.initial(note)`; composition never calls
the child's initializer. The [search example](../examples/search/README.md)
uses this for its detail feature.

Store snapshots are immutable. `changes` starts with the current state and
publishes new snapshots, coalescing updates for slow observers. `send` completes
after the transition commits and its commands are registered. It does not wait
for the timer to finish. Unexpected reducer or command failures close the store;
observe `closed` when hosting a store outside its normal UI lifetime.

## Composing children

Declare a child once, then reuse it for reducer composition and store scoping:

```ts
type ParentState = { readonly timer: State };
type ParentAction = Data.TaggedEnum<{ Timer: { readonly action: Action } }>;

const timerChild = Feature.child<ParentState, ParentAction>()({
  state: "timer",
  action: "Timer",
  feature: Timer,
});

const Parent = Feature.make<ParentState, ParentAction>()({
  initial: () => ({ timer: Timer.initial() }),
  reduce: (state) => ({ state }),
}).pipe(timerChild);
```

The child processes its action before the parent. Its emitted actions are mapped
back through the same route. Tagged action names accept cases with exactly
`_tag` and `action`. For nested state or other action shapes, pass an Effect optic
and a `Feature.Route` with `key`, `extract`, and `embed`. Route keys must be unique
within a parent.

`yield* Store.scope(parentStore, timerChild)` returns a store exposing only the
timer's state and actions. It shares the parent's runtime and dependencies.

Use `Feature.optionalChild` for `Option<ChildState>`. Setting it to `None` ends
the child's work. Supply `identity` when replacing a present child should also
end its old lifetime. Reopening after removal always creates a fresh lifetime.

Use `Feature.forEach` for a `ReadonlyMap<string, ChildState>`. Its route carries
`{ id, action }`; each map key identifies a separate child. Replace maps instead
of mutating them. Removing a key cancels only that child's work. See the
[collection example](../examples/collection/README.md).

Scoping an optional descriptor or a collection's `children.at(id)` returns an
`Option` of a child store. A handle belongs to one mounted lifetime: after
removal or an identity change, its reads and sends fail with `MissingChild` and its
subscriptions end. Scope the parent again to obtain the new child's handle.

## React and Atom

Create a binding once, outside render, using the application's Atom runtime:

```ts
import { FeatureAtom } from "@yielded/tca/atom";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

const app = FeatureAtom.bind(Parent, {
  runtime: Atom.runtime(Layer.empty),
});
const timer = FeatureAtom.scope(app, timerChild);
```

Inside a RegistryProvider, `useAtomValue(timer.state)` returns an AsyncResult and
`useAtomSet(timer.send)` returns a dispatcher. Handle Initial, Success, and
Failure in the view. The binding creates one store per registry. Releasing its
last subscriber and action mount disposes that store; keep a subscription at
the desired application lifetime. Scoped bindings use the same parent store and
dispatch child actions directly. `Atom.mapResult` can select smaller state slices.
Dispatch is asynchronous; keep controlled text-input drafts local so typing is
reflected immediately, and send their values as feature actions.

For optional children and collection entries, `FeatureAtom.scope` returns an
atom containing an AsyncResult of `Option<Binding>`. Render the present binding;
each new child lifetime gets a new binding, and old dispatchers cannot send into it.
Keep dynamic bindings within their originating registry; passing one through a
different RegistryProvider fails with `MissingChild`.

The [search application](../examples/search/README.md) shows the complete setup.

## TestStore

Supply the test runner's deep-equality assertion. TestStore holds command actions
until you receive them, using the same reducer and command runtime as Store.

```ts
import assert from "node:assert/strict";

import { TestStore } from "@yielded/tca";
import * as TestClock from "effect/testing/TestClock";

const scenario = TestStore.scenario(Timer, { assertEquals: assert.deepStrictEqual }, (store) =>
  Effect.gen(function* () {
    yield* store.send(Action.Start(), (state) => ({ ...state, running: true }));
    yield* TestClock.adjust("1 second");
    yield* store.receive(Action.Tick(), (state) => ({ ...state, seconds: 1 }));
    yield* store.send(Action.Stop(), (state) => ({ ...state, running: false }));
  }),
).pipe(Effect.provide(TestClock.layer()));
```

Each callback returns the complete expected next state. Omitting it asserts no
state change. Receive pending effect actions before sending more user actions.
`scenario` checks for pending emissions and unfinished commands after a successful
body, then disposes its scope. Cancel long-lived work explicitly first. For manual
scope ownership, use `TestStore.make` and call `finish` before disposal. Receive
timeouts use the current Effect clock, so with TestClock you must advance time and
retain the runner's overall wall timeout.
