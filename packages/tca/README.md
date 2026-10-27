# effect-tca

Composable state and scoped effects for TypeScript, built on Effect.

Features own state, actions, and synchronous reducers. Edit a temporary state
draft, then return an effect. Async work sends actions back through the reducer.

```sh
bun add effect-tca effect
```

This focus timer starts once, even if `Started` arrives repeatedly. Pausing stops
the ticking; starting again resumes from the same elapsed time.

```ts
import { Feature } from "effect-tca";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const Focus = Feature.make({
  actions: Schema.TaggedUnion({ Started: {}, Paused: {}, Tick: {} }),
  initial: () => ({ seconds: 0, running: false }),
  reduce: {
    Started: (state, _action, effect) => {
      if (state.running) return effect.none;
      state.running = true;

      return effect.replace(function* (send) {
        while (true) {
          yield* Effect.sleep("1 second");
          yield* send.Tick();
        }
      });
    },
    Paused: (state, _action, effect) => {
      state.running = false;

      return effect.cancel("Started");
    },
    Tick: (state, _action, effect) => {
      state.seconds += 1;

      return effect.none;
    },
  },
});
```

Starting is idempotent because the reducer commits `running = true` before the
effect starts. Further `Started` actions return `effect.none`. `effect.replace`
owns the timer under the `Started` action, so `Paused` can cancel it by name.
Only `Tick` edits the elapsed time; the async loop never holds a state draft.

For React, add `@effect/atom-react`, `react`, and `react-dom` with `bun add`.
Create the binding once, outside render:

```tsx
import { RegistryProvider, useAtomSet, useAtomSuspense } from "@effect/atom-react";
import { FeatureAtom } from "effect-tca/atom";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import { Suspense } from "react";

const timer = FeatureAtom.bind(Focus, {
  runtime: Atom.runtime(Layer.empty),
});

function FocusTimer() {
  const result = useAtomSuspense(timer.state, { includeFailure: true });
  const send = useAtomSet(timer.send);

  if (result._tag === "Failure") {
    return <p role="alert">The timer stopped unexpectedly.</p>;
  }

  const { seconds, running } = result.value;

  return (
    <section>
      <h1>Time to focus</h1>
      <output>{seconds}s focused</output>
      <button onClick={() => send({ _tag: running ? "Paused" : "Started" })}>
        {running ? "Pause" : "Start focusing"}
      </button>
    </section>
  );
}

export function App() {
  return (
    <RegistryProvider>
      <Suspense fallback={<p>Opening timer…</p>}>
        <FocusTimer />
      </Suspense>
    </RegistryProvider>
  );
}
```

The Atom binding gives each registry its own store. React reads state and sends
actions; releasing the last consumer disposes the store and cancels the timer.
The same lifetime rules apply to composed child features: removing a child ends
its work, and its queued actions cannot update a replacement.

Namespace exports are also available as direct imports such as
`effect-tca/Feature`. Core features and stores work without React; the Atom
adapter lives in `effect-tca/atom`.

See the [guide](https://github.com/danieljvdm/effect-tca/blob/main/docs/GUIDE.md)
for composition and TestStore, and the
[search example](https://github.com/danieljvdm/effect-tca/tree/main/examples/search)
for a complete application.
