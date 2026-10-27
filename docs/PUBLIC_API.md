# Public API contracts

`@yielded/tca` provides synchronous feature reducers, scoped effects and stores,
and a TestStore. `@yielded/tca/atom` adapts the same store to Effect Atom.
Applications own state and action types, service implementations, and views.
`Feature.make` also accepts an action `Schema.TaggedUnion`, an initializer, and
an exhaustive `cases` map. It infers action payloads, state, initializer input,
and the combined effect requirements. The schema remains available as
`feature.actions`. State annotations widen empty collections and optional values.
The existing typed reducer constructor remains available; declaring an action
schema does not add validation to ordinary store dispatch.
Feature initializers may require input. Store creation then requires that input
or an explicit initial state; child composition never calls the initializer.

A reducer returns the next immutable `state` and an optional `effects` array.
An Effect returns one action; a Stream emits actions sequentially. Both can be
returned directly. They run after the state commits and send actions through
the same serialized store.
Expected errors become application actions; unexpected effect or reducer
failures close the store and remain observable through `closed` and `send`.

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

Use `FeatureEffect.replace({ cancellationKey })` at the end of a program's pipeline
to replace earlier work with that key. `FeatureEffect.cancel({ cancellationKey })`
stops it without starting replacement work; a missing key is a no-op. Keys are
local to one mounted feature instance. Both operations invalidate already queued
actions immediately; cleanup may finish later. Unkeyed work needs neither helper.

Each emitted action waits for its state transition to commit. For an imperative
workflow, `FeatureEffect.withSend(send => program)` provides the same acknowledged
sender. Handle expected errors with native Effect or Stream operators before
returning work. Use `Stream.fromEffectDrain` for work that emits no action; an
Effect's result always represents an action, including `undefined`. Hot event
sources still need bounded buffering.

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
