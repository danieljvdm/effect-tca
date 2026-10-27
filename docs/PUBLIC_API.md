# Public API contracts

`@yielded/tca` provides synchronous feature reducers, scoped effects and stores,
and a TestStore. `@yielded/tca/atom` adapts the same store to Effect Atom.
Applications own state and action types, service implementations, and views.
`Feature.make` accepts an action `Schema.TaggedUnion`, an initializer, and `reduce`
as an exhaustive handler map or a single function. Reducers edit a synchronous
state draft and return one effect description. `effect.none` commits the edits
without starting work. It infers action payloads, state, initializer input, and
combined effect requirements. The schema remains available as `feature.actions`.
State annotations widen empty collections and optional values. Declaring an action
schema does not add validation to ordinary store dispatch.
Feature initializers may require input. Store creation then requires that input
or an explicit initial state; child composition never calls the initializer.

Drafts are valid only during synchronous reduction. The resulting snapshot is
immutable, and a failed reduction commits no state or effects. Capture ordinary
values before returning asynchronous work; accessing an escaped draft fails.
Effects run after the state commits and send actions through the same serialized store.
Expected errors become application actions; unexpected effect or reducer
failures close the store and remain observable through `closed` and `send`.

Draft state supports plain objects, arrays, native Maps and Sets, and
Immer-compatible classes, including `Schema.Class`. Snapshots are frozen at
initialization and after dispatch, including a supplied `initialState`. Map keys
and Effect `Option` contents are read-only; replace an Option as a whole.
Cycles, accessors, functions, non-enumerable plain-object fields, and custom array,
Map, or Set properties are unsupported. Supply Maps and Sets unfrozen or frozen
by Immer; native `Object.freeze` does not protect their entries. Other
non-draftable objects require the immutable reducer form. Draft mutation does
not rerun schema validation. Copy readonly arrays when assigning to mutable draft fields.

`Feature.child`, `optionalChild`, and `forEach` return reusable descriptors and
route actions before the parent reducer runs. The typed builder forms accept
state property names and tagged action names; explicit optics and routes support
other shapes. `Feature.tag` builds a route for a tagged case containing only an
`action` payload. Optional children
use `Option`; keyed children use `ReadonlyMap<string, State>`. A child's state
identity controls its effect lifetime. Replacing an optional child's identity,
removing it, or removing a keyed entry invalidates its queued actions and
interrupts its work. Reopening creates a fresh lifetime.

`Store.scope` and `FeatureAtom.scope` reuse these descriptors to expose child
state and actions through the existing parent runtime. Optional children and
`forEach` entries selected with `at(id)` expose presence explicitly. Each child
handle belongs to one mounted lifetime. Removed handles reject reads and sends
with a typed error, including actions queued before removal, and cannot target
a replacement child. Child subscriptions end when that lifetime ends.
Dynamic Atom bindings belong to the registry that produced them; another
registry rejects them instead of sharing state across registry boundaries.

All effects belong to their mounted feature's Effect scope. Removing the feature
interrupts its work and releases its resources. Each execution has its own resource
scope; programs can use `Effect.acquireRelease` without supplying a Scope themselves.
Dependencies are captured when the store is created. The caller's scope owns
the store and waits for its cleanup.

The reducer's `effect.run` starts independent work. `effect.replace` first revokes
the previous replacement execution for the incoming action tag in this mounted
feature. Function and map reducers use the same rule. Other action tags and
sibling features are independent. `effect.cancel("Started")` stops replacement
work owned by that action tag; a missing execution is a no-op. Replacement and
cancellation invalidate already queued actions immediately; cleanup may finish later.

`run` and `replace` accept a generator callback or a callback returning an Effect.
The callback receives schema-derived senders such as `send.ResultsLoaded({ results })`.
Each send is lazy and waits for its state transition to commit. Invalid internal
action construction is a defect. Handle expected service errors with native Effect
operators. Consume streams with `Stream.runForEach` and the same sender. Hot event
sources still need bounded buffering.

For explicit immutable updates and primitive state, `Feature.make<State, Action>()`
retains a reducer returning `{ state, effects? }`. Its effects array accepts native
Effects, Streams, and `FeatureEffect` descriptions. An Effect returns one action,
including `undefined`; a Stream emits zero or more. `FeatureEffect.withSend` supplies
an explicit sender, and `replace`/`cancel` use feature-local cancellation keys.

`send` completes after its action commits and its effects are registered. It
does not wait for those effects to finish. Action queues apply backpressure;
snapshot subscriptions retain the latest state and may coalesce intermediate
states. Reducers must not mutate earlier states or perform external work.
`Store.bindActions(store, actions)` derives payload-taking senders from an action
schema. Each returns an Effect that validates the constructor input and sends
through that store. Schema failures are typed and do not dispatch; scoped-store
lifetime checks still apply. Binding and constructing the Effect do no work.

TestStore uses the same runtime but holds effect emissions until `receive`.
The caller supplies the test runner's deep equality assertion. Each send and
receive checks the complete expected state. `finish` checks for unreceived
actions and running effects before disposal. `TestStore.scenario` owns disposal
and calls `finish` after a successful body; body failures remain unchanged.
Time remains under the caller's Effect TestClock. TestStore is a product API,
not a dependency on a test runner.

Stores are in-memory. State persistence, distributed delivery, durable jobs,
and process recovery belong to the host application.
