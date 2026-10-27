/**
 * Synchronous draft reducers, immutable feature definitions, and child composition.
 * @since 0.0.1
 */
import type * as Optic from "effect/Optic";
import * as Option from "effect/Option";
import type { Pipeable } from "effect/Pipeable";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { Immutable } from "immer";

import type * as FeatureEffect from "./FeatureEffect.ts";
import { draftTransition, snapshot } from "./internal/draft.ts";
import { createEffectContexts } from "./internal/effectContext.ts";
import { actionRoute, makeDefinition, stateLens } from "./internal/feature.ts";
import { normalize, type Operation } from "./internal/featureEffect.ts";
import { StoreError } from "./StoreError.ts";

/**
 * One atomic state transition and work to start after it commits.
 * @category models
 * @since 0.0.1
 */
export interface Transition<S, A, R = never> {
  readonly state: S;
  readonly effects?: ReadonlyArray<FeatureEffect.FeatureEffect<A, R>>;
}

/**
 * A reusable feature description. State and earlier snapshots must remain immutable.
 * @category models
 * @since 0.0.1
 */
export interface Definition<S, A, R = never, I = void> extends Pipeable {
  /** Constructs fresh state. Features with required input cannot initialize without it. */
  readonly initial: (input: I) => S;
  readonly reduce: (state: S, action: A) => Transition<S, A, R>;
  /** @internal Validates and freezes owned draft state before it becomes observable. */
  readonly prepare?: (state: S) => void;
  /** @internal */
  readonly lifetimes: (state: S) => ReadonlyArray<ReadonlyArray<string>>;
  /** @internal */
  readonly routes: ReadonlyArray<string>;
}

/**
 * A feature whose action schema remains available for constructors and bound senders.
 * Declaring a schema does not validate ordinary store dispatches.
 * @category models
 * @since 0.0.1
 */
export interface SchemaDefinition<
  S,
  C extends Record<string, Schema.Constraint>,
  R = never,
  I = void,
> extends Definition<S, C[keyof C]["Type"], R, I> {
  readonly actions: Schema.TaggedUnion<C>;
}

/**
 * Mutable state available only during a synchronous schema reducer. Objects,
 * arrays, Map values, Set values, and Immer-enabled classes can be edited.
 * Option values and Map keys stay deeply readonly; replace them instead.
 * Draft references are revoked when the reducer returns, including on failure.
 * @category models
 * @since 0.0.1
 */
export type Draft<S> = S extends (...args: never[]) => unknown
  ? S
  : S extends Option.Some<infer A>
    ? Option.Some<Immutable<A>>
    : S extends Option.None<infer A>
      ? Option.None<Immutable<A>>
      : S extends ReadonlyMap<infer K, infer V>
        ? Map<Immutable<K>, Draft<V>>
        : S extends ReadonlySet<infer V>
          ? Set<Draft<V>>
          : S extends object
            ? { -readonly [K in keyof S]: Draft<S[K]> }
            : S;

type Cases<S, C extends Record<string, Schema.Constraint>> = {
  readonly [K in keyof C]: (
    state: Draft<NoInfer<S>>,
    action: C[K]["Type"],
    effect: FeatureEffect.Context<C>,
  ) => FeatureEffect.ReducerEffect<C[keyof C]["Type"], unknown>;
};

type Reducer<S, C extends Record<string, Schema.Constraint>> = (
  state: Draft<NoInfer<S>>,
  action: C[keyof C]["Type"],
  effect: FeatureEffect.Context<C>,
) => FeatureEffect.ReducerEffect<C[keyof C]["Type"], unknown>;

type Requirements<T> =
  T extends FeatureEffect.Run<infer _A, infer R> ? Exclude<R, Scope.Scope> : never;

/**
 * Defines synchronous state transitions. The schema form accepts an exhaustive
 * handler map or one reducer function. Edit the draft and return `effect.none`,
 * `effect.run`, `effect.replace`, or `effect.cancel` on every path. Async work sends
 * actions; it cannot use the draft after the reducer returns.
 *
 * Schema state must have a draftable object root. Use plain objects, arrays,
 * Map/Set, or Immer-enabled classes (including Schema.Class). Option is immutable:
 * replace it as a whole. Snapshots are frozen; cycles, functions, and other object
 * types are rejected. Plain objects need enumerable data fields; arrays and
 * collections cannot have custom properties. Do not rely on mutations propagating
 * across shared aliases.
 * The typed two-call form instead accepts immutable transitions and arbitrary state.
 * Annotate the initializer's return type to widen empty collections or optional
 * state, and its parameter when state needs caller input. Requirements are inferred.
 * @example
 * ```ts
 * const Counter = Feature.make({
 *   actions: Schema.TaggedUnion({ Increment: {} }),
 *   initial: () => ({ count: 0 }),
 *   reduce: (state, _action, effect) => {
 *     state.count++
 *     return effect.none
 *   }
 * })
 * ```
 * @category constructors
 * @since 0.0.1
 */
export function make<S, A>(): <R = never, I = void>(spec: {
  readonly initial: (input: I) => S;
  readonly reduce: (state: S, action: A) => Transition<S, A, R>;
}) => Definition<S, A, Exclude<R, Scope.Scope>, I>;

export function make<
  C extends Record<string, Schema.Constraint>,
  S extends object,
  P extends Cases<S, C>,
  I = void,
>(spec: {
  readonly actions: Schema.TaggedUnion<C>;
  readonly initial: (input: I) => S;
  readonly reduce: P & { readonly [K in Exclude<keyof P, keyof C>]: never };
}): SchemaDefinition<S, C, Requirements<ReturnType<P[keyof P]>>, I>;

export function make<
  C extends Record<string, Schema.Constraint>,
  S extends object,
  P extends Reducer<S, C>,
  I = void,
>(spec: {
  readonly actions: Schema.TaggedUnion<C>;
  readonly initial: (input: I) => S;
  readonly reduce: P;
}): SchemaDefinition<S, C, Requirements<ReturnType<P>>, I>;

export function make<C extends Record<string, Schema.Constraint>, S extends object, I>(spec?: {
  readonly actions: Schema.TaggedUnion<C>;
  readonly initial: (input: I) => S;
  readonly reduce: Cases<S, C> | Reducer<S, C>;
}): unknown {
  if (spec === undefined) return makeDefinition;

  const contexts = createEffectContexts(spec.actions);

  return {
    ...makeDefinition({
      initial: (input: I) => snapshot(spec.initial(input)),
      reduce: (state: S, action: C[keyof C]["Type"]) => {
        const tag = (action as { readonly _tag: keyof C })._tag;
        const reduce = typeof spec.reduce === "function" ? spec.reduce : spec.reduce[tag];

        return draftTransition(state, (draft) => reduce(draft, action, contexts[tag]));
      },
    }),
    prepare: snapshot<S>,
    actions: spec.actions,
  };
}

/**
 * An action route and its stable, parent-local lifetime namespace.
 * @category models
 * @since 0.0.1
 */
export interface Route<A, B> {
  readonly key: string;
  readonly extract: (action: A) => Option.Option<B>;
  readonly embed: (action: B) => A;
}

type Tagged = { readonly _tag: string };
type Payload<A> = A extends { readonly action: infer B } ? B : never;
type Tags<A extends Tagged> = {
  [T in A["_tag"]]: Extract<A, { readonly _tag: T }> extends { readonly action: unknown }
    ? Exclude<keyof Extract<A, { readonly _tag: T }>, "_tag" | "action"> extends never
      ? T
      : never
    : never;
}[A["_tag"]];

/**
 * Routes a tagged case whose only fields are `_tag` and `action`.
 * For other shapes, supply a Route with explicit extract and embed functions.
 * @category constructors
 * @since 0.0.1
 */
export const tag =
  <A extends Tagged>() =>
  <T extends Tags<A>>(key: T): Route<A, Payload<Extract<A, { readonly _tag: T }>>> =>
    actionRoute(key);

type StateKey<S, CS> = {
  [K in keyof S]-?: [S[K]] extends [CS] ? ([CS] extends [S[K]] ? K : never) : never;
}[keyof S];

type ActionTag<A, CA> = [A] extends [Tagged]
  ? {
      [T in Tags<A>]: [Payload<Extract<A, { readonly _tag: T }>>] extends [CA]
        ? [CA] extends [Payload<Extract<A, { readonly _tag: T }>>]
          ? T
          : never
        : never;
    }[Tags<A>]
  : never;

/**
 * A child state and action focus shared by reducer composition and scoped stores.
 * Paths are relative to the parent and identify the mounted child lifetime.
 * Use child descriptors or a collection descriptor's `at` instead of constructing one.
 * @category models
 * @since 0.0.1
 */
export interface Focus<
  S,
  A,
  CS,
  CA,
  K extends "Child" | "OptionalChild" = "Child" | "OptionalChild",
> {
  readonly _tag: K;
  readonly select: (state: S) => Option.Option<CS>;
  readonly embed: (action: CA) => A;
  readonly path: (state: S) => Option.Option<ReadonlyArray<string>>;
}

/**
 * Reusable required-child composition and store focus. Applying it preserves the
 * parent's initializer input and includes the child's effect requirements.
 * @category models
 * @since 0.0.1
 */
export interface ChildDescriptor<S, A, CS, CA, CR>
  extends Focus<S, A, CS, CA, "Child">, Composition<S, A, CR> {}

/**
 * Reusable optional-child composition and store focus. Its identity policy is
 * shared by reducer cancellation and scoped store handles.
 * @category models
 * @since 0.0.1
 */
export interface OptionalChildDescriptor<S, A, CS, CA, CR>
  extends Focus<S, A, CS, CA, "OptionalChild">, Composition<S, A, CR> {}

/**
 * Reusable collection composition. `at(id)` focuses one optional keyed child;
 * removing and re-adding its ID creates a new lifetime.
 * @category models
 * @since 0.0.1
 */
export interface ForEachDescriptor<S, A, CS, CA, CR> extends Composition<S, A, CR> {
  readonly _tag: "ForEach";
  readonly at: (id: string) => Focus<S, A, CS, CA, "OptionalChild">;
}

interface Composition<S, A, CR> {
  <R, I, Metadata extends object>(
    self: Definition<S, A, R, I> & Metadata,
  ): Definition<S, A, R | CR, I> & Pick<Metadata, Extract<keyof Metadata, "actions">>;
}

/**
 * One child's state focus, action route, and reusable definition.
 * @category models
 * @since 0.0.1
 */
export interface Child<S, A, CS, CA, CR> {
  readonly state: Optic.Lens<S, CS> | StateKey<S, NoInfer<CS>>;
  readonly action: Route<A, CA> | ActionTag<A, NoInfer<CA>>;
  /** Composition uses existing child state; it never invokes the initializer. */
  readonly feature: Definition<CS, CA, CR, never>;
}

const rebase = <A, B, R>(
  effect: FeatureEffect.FeatureEffect<A, R>,
  path: ReadonlyArray<string>,
  embed: (action: A) => B,
): Operation<B, R> => {
  const operation = normalize(effect);
  const rebasedPath = [...path, ...operation.path];

  return operation._tag === "Cancel"
    ? { ...operation, path: rebasedPath }
    : {
        ...operation,
        path: rebasedPath,
        run: (send) => operation.run((action) => send(embed(action))),
      };
};

const register = <S, A, R, I>(self: Definition<S, A, R, I>, key: string): ReadonlyArray<string> => {
  if (self.routes.includes(key))
    throw StoreError.make({ reason: "Reducer", message: `Duplicate child route: ${key}` });

  return [...self.routes, key];
};

const prepareChildren = <S, CS>(
  parent: ((state: S) => void) | undefined,
  child: ((state: CS) => void) | undefined,
  visit: (state: S, prepare: (state: CS) => void) => void,
): ((state: S) => void) | undefined => {
  if (child === undefined) return parent;

  return (state) => {
    parent?.(state);
    visit(state, child);
  };
};

/**
 * Runs the child before the parent and lifts its effects into the parent lifetime.
 * Reuse the descriptor with Store.scope or FeatureAtom.scope. The two-call form
 * accepts checked state property and action tag names. Duplicate route keys throw
 * StoreError during composition.
 * @category combinators
 * @since 0.0.1
 */
export function child<S, A>(): <CS, CA, CR>(
  options: Child<S, A, CS, CA, CR>,
) => ChildDescriptor<S, A, CS, CA, CR>;

export function child<S, A, CS, CA, CR>(
  options: Child<S, A, CS, CA, CR>,
): ChildDescriptor<S, A, CS, CA, CR>;

export function child<S, A, CS, CA, CR>(
  options?: Child<S, A, CS, CA, CR>,
):
  | ChildDescriptor<S, A, CS, CA, CR>
  | (<S2, A2, R2>(options: Child<S, A, S2, A2, R2>) => ChildDescriptor<S, A, S2, A2, R2>) {
  if (options === undefined)
    return <S2, A2, R2>(options: Child<S, A, S2, A2, R2>) => child(options);

  const state = stateLens(options.state);
  const action = actionRoute(options.action);

  return Object.assign(
    <R, I, Metadata extends object>(
      self: Definition<S, A, R, I> & Metadata,
    ): Definition<S, A, R | CR, I> & Metadata => ({
      ...self,
      prepare: prepareChildren(self.prepare, options.feature.prepare, (current, prepare) =>
        prepare(state.get(current)),
      ),
      routes: register(self, action.key),
      lifetimes: (current) => [
        ...self.lifetimes(current),
        ...options.feature.lifetimes(state.get(current)).map((path) => [action.key, ...path]),
      ],
      reduce: (current, incoming) => {
        const selected = action.extract(incoming);

        if (Option.isNone(selected)) return self.reduce(current, incoming);

        const result = options.feature.reduce(state.get(current), selected.value);
        const parent = self.reduce(state.replace(result.state, current), incoming);

        return {
          state: parent.state,
          effects: [
            ...(result.effects ?? []).map((effect) => rebase(effect, [action.key], action.embed)),
            ...(parent.effects ?? []),
          ],
        };
      },
    }),
    {
      _tag: "Child" as const,
      select: (current: S): Option.Option<CS> => Option.some(state.get(current)),
      embed: action.embed,
      path: (): Option.Option<ReadonlyArray<string>> => Option.some([action.key]),
    },
  );
}

/**
 * Optional state with an explicit action route. `identity` defaults to one identity
 * per presentation; supply it when replacing a present child must end its old work.
 * @category models
 * @since 0.0.1
 */
export interface OptionalChild<S, A, CS, CA, CR> {
  readonly state: Optic.Lens<S, Option.Option<CS>> | StateKey<S, Option.Option<NoInfer<CS>>>;
  readonly action: Route<A, CA> | ActionTag<A, NoInfer<CA>>;
  /** Composition uses existing child state; it never invokes the initializer. */
  readonly feature: Definition<CS, CA, CR, never>;
  readonly identity?: (state: CS) => string;
}

/**
 * Composes an optional child. Removal or identity replacement cancels its work.
 * An external child action while absent throws StoreError; obsolete effect actions
 * are discarded by the store before reaching the reducer. Reuse the descriptor
 * to scope a store to the same lifetime. The two-call form accepts checked names.
 * @category combinators
 * @since 0.0.1
 */
export function optionalChild<S, A>(): <CS, CA, CR>(
  options: OptionalChild<S, A, CS, CA, CR>,
) => OptionalChildDescriptor<S, A, CS, CA, CR>;

export function optionalChild<S, A, CS, CA, CR>(
  options: OptionalChild<S, A, CS, CA, CR>,
): OptionalChildDescriptor<S, A, CS, CA, CR>;

export function optionalChild<S, A, CS, CA, CR>(
  options?: OptionalChild<S, A, CS, CA, CR>,
):
  | OptionalChildDescriptor<S, A, CS, CA, CR>
  | (<S2, A2, R2>(
      options: OptionalChild<S, A, S2, A2, R2>,
    ) => OptionalChildDescriptor<S, A, S2, A2, R2>) {
  if (options === undefined)
    return <S2, A2, R2>(options: OptionalChild<S, A, S2, A2, R2>) => optionalChild(options);

  const state = stateLens(options.state);
  const action = actionRoute(options.action);
  const path = (current: CS) => [action.key, options.identity?.(current) ?? "present"];

  return Object.assign(
    <R, I, Metadata extends object>(
      self: Definition<S, A, R, I> & Metadata,
    ): Definition<S, A, R | CR, I> & Metadata => ({
      ...self,
      prepare: prepareChildren(self.prepare, options.feature.prepare, (current, prepare) => {
        const selected = state.get(current);

        if (Option.isSome(selected)) prepare(selected.value);
      }),
      routes: register(self, action.key),
      lifetimes: (current) => {
        const selected = state.get(current);

        return [
          ...self.lifetimes(current),
          ...(Option.isSome(selected)
            ? options.feature
                .lifetimes(selected.value)
                .map((tail) => [...path(selected.value), ...tail])
            : []),
        ];
      },
      reduce: (current, incoming) => {
        const selected = action.extract(incoming);

        if (Option.isNone(selected)) return self.reduce(current, incoming);

        const childState = state.get(current);

        if (Option.isNone(childState))
          throw StoreError.make({
            reason: "MissingChild",
            message: `Child ${action.key} is absent`,
          });

        const result = options.feature.reduce(childState.value, selected.value);
        const parent = self.reduce(state.replace(Option.some(result.state), current), incoming);

        return {
          state: parent.state,
          effects: [
            ...(result.effects ?? []).map((effect) =>
              rebase(effect, path(childState.value), action.embed),
            ),
            ...(parent.effects ?? []),
          ],
        };
      },
    }),
    {
      _tag: "OptionalChild" as const,
      select: state.get,
      embed: action.embed,
      path: (current: S): Option.Option<ReadonlyArray<string>> =>
        Option.map(state.get(current), path),
    },
  );
}

/**
 * A child action addressed by a stable string ID.
 * @category models
 * @since 0.0.1
 */
export interface Identified<A> {
  readonly id: string;
  readonly action: A;
}

/**
 * A collection state focus, identified action route, and child definition.
 * Composition uses existing entries rather than invoking the child's initializer.
 * @category models
 * @since 0.0.1
 */
export interface ForEach<S, A, CS, CA, CR> {
  readonly state:
    | Optic.Lens<S, ReadonlyMap<string, CS>>
    | StateKey<S, ReadonlyMap<string, NoInfer<CS>>>;
  readonly action: Route<A, Identified<CA>> | ActionTag<A, Identified<NoInfer<CA>>>;
  readonly feature: Definition<CS, CA, CR, never>;
}

/**
 * Composes a map of independent children. Removed IDs lose their effect lifetime.
 * Map iteration order does not affect identity. Treat maps and entries as immutable.
 * Use the descriptor's `at(id)` to scope a store to one mounted entry. The two-call
 * form accepts checked state property and action tag names.
 * @category combinators
 * @since 0.0.1
 */
export function forEach<S, A>(): <CS, CA, CR>(
  options: ForEach<S, A, CS, CA, CR>,
) => ForEachDescriptor<S, A, CS, CA, CR>;

export function forEach<S, A, CS, CA, CR>(
  options: ForEach<S, A, CS, CA, CR>,
): ForEachDescriptor<S, A, CS, CA, CR>;

export function forEach<S, A, CS, CA, CR>(
  options?: ForEach<S, A, CS, CA, CR>,
):
  | ForEachDescriptor<S, A, CS, CA, CR>
  | (<S2, A2, R2>(options: ForEach<S, A, S2, A2, R2>) => ForEachDescriptor<S, A, S2, A2, R2>) {
  if (options === undefined)
    return <S2, A2, R2>(options: ForEach<S, A, S2, A2, R2>) => forEach(options);

  const state = stateLens(options.state);
  const action = actionRoute(options.action);

  return Object.assign(
    <R, I, Metadata extends object>(
      self: Definition<S, A, R, I> & Metadata,
    ): Definition<S, A, R | CR, I> & Metadata => ({
      ...self,
      prepare: prepareChildren(self.prepare, options.feature.prepare, (current, prepare) => {
        for (const entry of state.get(current).values()) prepare(entry);
      }),
      routes: register(self, action.key),
      lifetimes: (current) => [
        ...self.lifetimes(current),
        ...Array.from(state.get(current), ([id, value]) =>
          options.feature.lifetimes(value).map((path) => [action.key, id, ...path]),
        ).flat(),
      ],
      reduce: (current, incoming) => {
        const selected = action.extract(incoming);

        if (Option.isNone(selected)) return self.reduce(current, incoming);

        const { id, action: childAction } = selected.value;
        const entries = state.get(current);

        if (!entries.has(id))
          throw StoreError.make({
            reason: "MissingChild",
            message: `Child ${action.key}/${id} is absent`,
          });

        // Map.has above distinguishes a missing entry from a valid undefined state.
        const result = options.feature.reduce(entries.get(id) as CS, childAction);
        const updated = new Map(entries);

        updated.set(id, result.state);

        const parent = self.reduce(state.replace(updated, current), incoming);

        return {
          state: parent.state,
          effects: [
            ...(result.effects ?? []).map((effect) =>
              rebase(effect, [action.key, id], (child) => action.embed({ id, action: child })),
            ),
            ...(parent.effects ?? []),
          ],
        };
      },
    }),
    {
      _tag: "ForEach" as const,
      at: (id: string): Focus<S, A, CS, CA, "OptionalChild"> => ({
        _tag: "OptionalChild",
        select: (current) => {
          const entries = state.get(current);

          return entries.has(id) ? Option.some(entries.get(id) as CS) : Option.none();
        },
        embed: (child) => action.embed({ id, action: child }),
        path: (current) =>
          state.get(current).has(id) ? Option.some([action.key, id]) : Option.none(),
      }),
    },
  );
}
