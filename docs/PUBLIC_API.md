# Public API contracts

`@yielded/tca` provides synchronous feature reducers, commands, scoped stores,
and a TestStore. `@yielded/tca/atom` adapts the same store to Effect Atom.
Applications own state and action types, service implementations, and views.
Feature initializers may require input. Store creation then requires that input
or an explicit initial state; child composition never calls the initializer.

A reducer returns the next immutable state and optional commands. Commands run
after the state commits and send actions through the same serialized store.
Expected errors become application actions; unexpected command or reducer
failures close the store and remain observable through `closed` and `send`.

`Feature.child`, `optionalChild`, and `forEach` return reusable descriptors and
route actions before the parent reducer runs. The typed builder forms accept
state property names and tagged action names; explicit optics and routes support
other shapes. `Feature.tag` builds a route for a tagged case containing only an
`action` payload. Optional children
use `Option`; keyed children use `ReadonlyMap<string, State>`. A child's state
identity controls its command lifetime. Replacing an optional child's identity,
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

Commands accept an Effect returning one action, or a callback receiving `send`
for multiple emissions. Command keys are local to a feature instance. `latest`
invalidates the previous execution before starting its replacement; `cancel`
also fences already queued
actions. Each execution has its own Effect scope. Dependencies are captured when
the store is created. The caller's scope owns the store and its finalizers.

`send` completes after its action commits and its commands are registered. It
does not wait for those commands to finish. Action queues apply backpressure;
snapshot subscriptions retain the latest state and may coalesce intermediate
states. Reducers must not mutate earlier states or perform external work.

TestStore uses the same runtime but holds effect emissions until `receive`.
The caller supplies the test runner's deep equality assertion. Each send and
receive checks the complete expected state. `finish` checks for unreceived
actions and running commands before disposal. `TestStore.scenario` owns disposal
and calls `finish` after a successful body; body failures remain unchanged.
Time remains under the caller's Effect TestClock. TestStore is a product API,
not a dependency on a test runner.

Stores are in-memory. State persistence, distributed delivery, durable jobs,
and process recovery belong to the host application.
