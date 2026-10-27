/**
 * Immutable feature definitions and typed child composition.
 * @since 0.1.0-beta.0
 */
import type * as Optic from "effect/Optic";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";

import * as Command from "./Command.ts";
import { actionRoute, stateLens } from "./internal/feature.ts";
import { StoreError } from "./StoreError.ts";

/**
 * One atomic state transition and work to start after it commits.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Transition<S, A, R = never> {
  readonly state: S;
  readonly commands?: ReadonlyArray<Command.Command<A, R>>;
}

/**
 * A reusable feature description. State and earlier snapshots must remain immutable.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Definition<S, A, R = never, I = void> extends Pipeable {
  /** Constructs fresh state. Features with required input cannot initialize without it. */
  readonly initial: (input: I) => S;
  readonly reduce: (state: S, action: A) => Transition<S, A, R>;
  /** @internal */
  readonly lifetimes: (state: S) => ReadonlyArray<ReadonlyArray<string>>;
  /** @internal */
  readonly routes: ReadonlyArray<string>;
}

/**
 * Defines synchronous state transitions. The second call infers command requirements
 * and initializer input. Annotate an initializer parameter when state needs caller input.
 * @example
 * ```ts
 * const Counter = Feature.make<{ readonly count: number }, "increment">()({
 *   initial: () => ({ count: 0 }),
 *   reduce: (state) => ({ state: { count: state.count + 1 } })
 * })
 * ```
 * @category constructors
 * @since 0.1.0-beta.0
 */
export const make =
  <S, A>() =>
  <R = never, I = void>(spec: {
    readonly initial: (input: I) => S;
    readonly reduce: (state: S, action: A) => Transition<S, A, R>;
  }): Definition<S, A, R, I> => ({
    ...spec,
    lifetimes: () => [[]],
    routes: [],
    pipe() {
      return pipeArguments(this, arguments);
    },
  });

/**
 * An action route and its stable, parent-local lifetime namespace.
 * @category models
 * @since 0.1.0-beta.0
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
 * @since 0.1.0-beta.0
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
 * @since 0.1.0-beta.0
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
 * parent's initializer input and includes the child's command requirements.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface ChildDescriptor<S, A, CS, CA, CR> extends Focus<S, A, CS, CA, "Child"> {
  <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I>;
}

/**
 * Reusable optional-child composition and store focus. Its identity policy is
 * shared by reducer cancellation and scoped store handles.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface OptionalChildDescriptor<S, A, CS, CA, CR> extends Focus<
  S,
  A,
  CS,
  CA,
  "OptionalChild"
> {
  <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I>;
}

/**
 * Reusable collection composition. `at(id)` focuses one optional keyed child;
 * removing and re-adding its ID creates a new lifetime.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface ForEachDescriptor<S, A, CS, CA, CR> {
  readonly _tag: "ForEach";
  readonly at: (id: string) => Focus<S, A, CS, CA, "OptionalChild">;
  <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I>;
}

/**
 * One child's state focus, action route, and reusable definition.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Child<S, A, CS, CA, CR> {
  readonly state: Optic.Lens<S, CS> | StateKey<S, NoInfer<CS>>;
  readonly action: Route<A, CA> | ActionTag<A, NoInfer<CA>>;
  /** Composition uses existing child state; it never invokes the initializer. */
  readonly feature: Definition<CS, CA, CR, never>;
}

const rebase = <A, B, R>(
  command: Command.Command<A, R>,
  path: ReadonlyArray<string>,
  embed: (action: A) => B,
): Command.Command<B, R> => ({
  ...Command.map(command, embed),
  path: [...path, ...command.path],
});

const register = <S, A, R, I>(self: Definition<S, A, R, I>, key: string): ReadonlyArray<string> => {
  if (self.routes.includes(key))
    throw StoreError.make({ reason: "Reducer", message: `Duplicate child route: ${key}` });

  return [...self.routes, key];
};

/**
 * Runs the child before the parent and lifts its commands into the parent lifetime.
 * Reuse the descriptor with Store.scope or FeatureAtom.scope. The two-call form
 * accepts checked state property and action tag names. Duplicate route keys throw
 * StoreError during composition.
 * @category combinators
 * @since 0.1.0-beta.0
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
    <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I> => ({
      ...self,
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
          commands: [
            ...(result.commands ?? []).map((command) =>
              rebase(command, [action.key], action.embed),
            ),
            ...(parent.commands ?? []),
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
 * @since 0.1.0-beta.0
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
 * An external child action while absent throws StoreError; obsolete command actions
 * are discarded by the store before reaching the reducer. Reuse the descriptor
 * to scope a store to the same lifetime. The two-call form accepts checked names.
 * @category combinators
 * @since 0.1.0-beta.0
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
    <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I> => ({
      ...self,
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
          commands: [
            ...(result.commands ?? []).map((command) =>
              rebase(command, path(childState.value), action.embed),
            ),
            ...(parent.commands ?? []),
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
 * @since 0.1.0-beta.0
 */
export interface Identified<A> {
  readonly id: string;
  readonly action: A;
}

/**
 * A collection state focus, identified action route, and child definition.
 * Composition uses existing entries rather than invoking the child's initializer.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface ForEach<S, A, CS, CA, CR> {
  readonly state:
    | Optic.Lens<S, ReadonlyMap<string, CS>>
    | StateKey<S, ReadonlyMap<string, NoInfer<CS>>>;
  readonly action: Route<A, Identified<CA>> | ActionTag<A, Identified<NoInfer<CA>>>;
  readonly feature: Definition<CS, CA, CR, never>;
}

/**
 * Composes a map of independent children. Removed IDs lose their command lifetime.
 * Map iteration order does not affect identity. Treat maps and entries as immutable.
 * Use the descriptor's `at(id)` to scope a store to one mounted entry. The two-call
 * form accepts checked state property and action tag names.
 * @category combinators
 * @since 0.1.0-beta.0
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
    <R, I>(self: Definition<S, A, R, I>): Definition<S, A, R | CR, I> => ({
      ...self,
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
          commands: [
            ...(result.commands ?? []).map((command) =>
              rebase(command, [action.key, id], (child) => action.embed({ id, action: child })),
            ),
            ...(parent.commands ?? []),
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
