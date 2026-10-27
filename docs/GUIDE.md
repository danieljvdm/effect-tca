# Building a feature

Define actions and edit a synchronous state draft in `reduce`. Every handler
returns an effect, including `effect.none` when there is no work to start.
A feature definition can create many independent stores. Each store's scope
owns its work and subscriptions.

```ts
import { Feature, Store } from "effect-tca";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

type State = { readonly seconds: number; readonly running: boolean };
const Action = Schema.TaggedUnion({ Start: {}, Stop: {}, Tick: {} });
type Action = typeof Action.Type;

const Timer = Feature.make({
  actions: Action,
  initial: (): State => ({ seconds: 0, running: false }),
  reduce: {
    Start: (state, _action, effect) => {
      state.running = true;

      return effect.replace(function* (send) {
        yield* Stream.runForEach(Stream.tick("1 second").pipe(Stream.drop(1)), () => send.Tick());
      });
    },
    Stop: (state, _action, effect) => {
      state.running = false;

      return effect.cancel("Start");
    },
    Tick: (state, _action, effect) => {
      state.seconds += 1;

      return effect.none;
    },
  },
});
```

The action schema supplies handler payloads and the methods on `send`. Instead
of a handler map, `reduce` can be a function `(state, action, effect)` with a
switch on `action._tag`; both forms must return an effect on every path. Annotate
the initializer's return type when empty collections or optional values need
a wider state type.

State edits commit before work starts. Drafts are revoked when reduction ends:
capture needed values before returning `effect.run` or `effect.replace`, and
send actions to update state asynchronously. `effect.none` still commits state
edits. Reducer failures commit neither edits nor work.

Drafts support plain objects, arrays, native Maps and Sets, and `Schema.Class`
instances. Replace `Option` values as a whole; their contents remain read-only.
Copy readonly arrays when assigning them to a draft,
for example `state.results = [...results]`. See the [public contracts](PUBLIC_API.md)
for the immutable reducer form and state limitations.

`effect.run` starts independent work. `effect.replace` replaces previous work
started by the same action tag, so another Start restarts this timer. Stop names
the Start action to cancel it. Each mounted feature has independent lifetimes;
cancelled work cannot commit already queued actions. Removing a feature ends
all its work. The [search example](../examples/search/README.md) uses this for a
detail timer that only stops when the detail disappears.

Both constructors accept generators or callbacks returning an Effect. Each
`send` waits for its state transition to commit. A callback may finish without
sending an action. Use ordinary Effect services (`const api = yield* Api`),
resource acquisition, retry, and error operators inside it; provide service
Layers when creating the store. Convert expected failures into application
actions. Invalid internal action construction is a defect.

The timer drops `Stream.tick`'s immediate first emission to wait a full second.
Hot event sources still need bounded buffering.

```ts
const program = Effect.gen(function* () {
  const store = yield* Store.make(Timer);
  const actions = Store.bindActions(store, Action);
  yield* actions.Start();
  yield* Effect.sleep("2 seconds");
  yield* actions.Stop();
  return yield* store.get;
}).pipe(Effect.scoped);
```

Bound senders accept each case's constructor payload and validate it when their
Effect runs. Invalid payloads fail with a `SchemaIssue.Issue` without dispatching.
You can also send an action directly with `store.send`; ordinary dispatch does
not validate schemas. Both forms retain the store's lifetime checks.

An initializer can require data, such as `initial: (note: Note) => ...`.
Create that store with `{ input: note }`, or supply `{ initialState }` directly.
Parents initialize children with `Detail.initial(note)`; composition never calls
the child's initializer. The [search example](../examples/search/README.md)
uses this for its detail feature.

Store snapshots are immutable. `changes` starts with the current state and
publishes new snapshots, coalescing updates for slow observers. `send` completes
after the transition commits and its effects are registered. It does not wait
for the timer to finish. Unexpected reducer or effect failures close the store;
observe `closed` when hosting a store outside its normal UI lifetime.

## Composing children

Declare a child once, then reuse it for reducer composition and store scoping:

```ts
import * as Optic from "effect/Optic";

type ParentState = { readonly timer: State };
const ParentAction = Schema.TaggedUnion({ Timer: { action: Action } });
type ParentAction = typeof ParentAction.Type;
const timerState = Optic.id<ParentState>().key("timer");

const timerChild = Feature.child<ParentState, ParentAction>()({
  state: timerState,
  action: "Timer",
  feature: Timer,
});

const Parent = Feature.make({
  actions: ParentAction,
  initial: () => ({ timer: Timer.initial() }),
  reduce: { Timer: (_state, _action, effect) => effect.none },
}).pipe(timerChild);
```

The child processes its action before the parent. Its emitted actions are mapped
back through the same route. Tagged action names accept cases with exactly
`_tag` and `action`. For nested state or other action shapes, pass an Effect optic
and a `Feature.Route` with `key`, `extract`, and `embed`. Route keys must be unique
within a parent.

Use a property name such as `state: "timer"` for a direct child. Optics can
focus composition into deeper state. Inside reducers, edit the draft directly;
for example, `state.timer.seconds += 1` preserves earlier snapshots.

`yield* Store.scope(parentStore, timerChild)` returns a store exposing only the
timer's state and actions. It shares the parent's runtime and dependencies.

Use `Feature.optionalChild` for `Option<ChildState>`. Setting it to `None` ends
the child's work. Supply `identity` when replacing a present child should also
end its old lifetime. Reopening after removal always creates a fresh lifetime.

Use `Feature.forEach` for a `ReadonlyMap<string, ChildState>`. Its route carries
`{ id, action }`; each map key identifies a separate child. Edit the map through
the parent's draft. Removing a key cancels only that child's work. See the
[collection example](../examples/collection/README.md).

Scoping an optional descriptor or a collection's `children.at(id)` returns an
`Option` of a child store. A handle belongs to one mounted lifetime: after
removal or an identity change, its reads and sends fail with `MissingChild` and its
subscriptions end. Scope the parent again to obtain the new child's handle.

## React and Atom

Create a binding once, outside render, using the application's Atom runtime:

```ts
import { FeatureAtom } from "effect-tca/atom";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";

const app = FeatureAtom.bind(Parent, {
  runtime: Atom.runtime(Layer.empty),
});
const timer = FeatureAtom.scope(app, timerChild);
```

Inside a RegistryProvider, `useAtomSuspense(timer.state).value` reads state under
React Suspense and an error boundary; `useAtomSet(timer.send)` returns a dispatcher.
For explicit loading and failure UI, use `useAtomValue` and handle its AsyncResult.
The binding creates one store per registry. Releasing its
last subscriber and action mount disposes that store; keep a subscription at
the desired application lifetime. Scoped bindings use the same parent store and
dispatch child actions directly. Select a smaller state slice with
`timer.state.pipe(Atom.mapResult((state) => state.seconds))`.
Dispatch is asynchronous; keep controlled text-input drafts local so typing is
reflected immediately, and send their values as feature actions.

For optional children and collection entries, `FeatureAtom.scope` returns an
atom containing an AsyncResult of `Option<Binding>`. Render the present binding;
each new child lifetime gets a new binding, and old dispatchers cannot send into it.
Keep dynamic bindings within their originating registry; passing one through a
different RegistryProvider fails with `MissingChild`.

For keyed children, cache the presence atom with
`Atom.family((id: string) => FeatureAtom.scope(app, children.at(id)))`.
Reuse that family outside render so repeated IDs select the same atom while
new child lifetimes still produce fresh bindings.

The [search application](../examples/search/README.md) shows the complete setup.

## TestStore

Supply the test runner's deep-equality assertion. TestStore holds effect actions
until you receive them, using the same reducer and effect runtime as Store.

```ts
import assert from "node:assert/strict";

import { TestStore } from "effect-tca";
import * as TestClock from "effect/testing/TestClock";

const scenario = TestStore.scenario(Timer, { assertEquals: assert.deepStrictEqual }, (store) =>
  Effect.gen(function* () {
    yield* store.send(Action.cases.Start.make({}), (state) => ({ ...state, running: true }));
    yield* TestClock.adjust("1 second");
    yield* store.receive(Action.cases.Tick.make({}), (state) => ({ ...state, seconds: 1 }));
    yield* store.send(Action.cases.Stop.make({}), (state) => ({ ...state, running: false }));
  }),
).pipe(Effect.provide(TestClock.layer()));
```

Each callback returns the complete expected next state. Omitting it asserts no
state change. Receive pending effect actions before sending more user actions.
`scenario` checks for pending emissions and unfinished effects after a successful
body, then disposes its scope. Cancel long-lived work explicitly first. For manual
scope ownership, use `TestStore.make` and call `finish` before disposal. Receive
timeouts use the current Effect clock, so with TestClock you must advance time and
retain the runner's overall wall timeout.
