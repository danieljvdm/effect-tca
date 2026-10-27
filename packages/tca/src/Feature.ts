/**
 * Immutable feature definitions and typed child composition.
 * @since 0.1.0-beta.0
 */
import type * as Optic from "effect/Optic";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";

import * as Command from "./Command.ts";
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
export interface Definition<S, A, R = never> extends Pipeable {
  readonly initial: () => S;
  readonly reduce: (state: S, action: A) => Transition<S, A, R>;
  /** @internal */
  readonly lifetimes: (state: S) => ReadonlyArray<ReadonlyArray<string>>;
  /** @internal */
  readonly routes: ReadonlyArray<string>;
}

/**
 * Defines synchronous state transitions. The second call infers command requirements.
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
  <R = never>(spec: {
    readonly initial: () => S;
    readonly reduce: (state: S, action: A) => Transition<S, A, R>;
  }): Definition<S, A, R> => ({
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
  <T extends Tags<A>>(key: T): Route<A, Payload<Extract<A, { readonly _tag: T }>>> => ({
    key,
    extract: (action) =>
      action._tag === key
        ? // Tags only admits cases with exactly the discriminant and this payload.
          Option.some(
            (
              action as Extract<A, { readonly _tag: T }> & {
                readonly action: Payload<Extract<A, { readonly _tag: T }>>;
              }
            ).action,
          )
        : Option.none(),
    embed: (action) => ({ _tag: key, action }) as unknown as A,
  });

/**
 * One child's state focus, action route, and reusable definition.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface Child<S, A, CS, CA, CR> {
  readonly state: Optic.Lens<S, CS>;
  readonly action: Route<A, CA>;
  readonly feature: Definition<CS, CA, CR>;
}

const rebase = <A, B, R>(
  command: Command.Command<A, R>,
  path: ReadonlyArray<string>,
  embed: (action: A) => B,
): Command.Command<B, R> => ({
  ...Command.map(command, embed),
  path: [...path, ...command.path],
});

const register = <S, A, R>(self: Definition<S, A, R>, key: string): ReadonlyArray<string> => {
  if (self.routes.includes(key))
    throw StoreError.make({ reason: "Reducer", message: `Duplicate child route: ${key}` });

  return [...self.routes, key];
};

/**
 * Runs the child before the parent and lifts its commands into the parent lifetime.
 * Duplicate route keys throw StoreError during composition.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export const child =
  <S, A, CS, CA, CR>(options: Child<S, A, CS, CA, CR>) =>
  <R>(self: Definition<S, A, R>): Definition<S, A, R | CR> => ({
    ...self,
    routes: register(self, options.action.key),
    lifetimes: (state) => [
      ...self.lifetimes(state),
      ...options.feature
        .lifetimes(options.state.get(state))
        .map((path) => [options.action.key, ...path]),
    ],
    reduce: (state, action) => {
      const selected = options.action.extract(action);

      if (Option.isNone(selected)) return self.reduce(state, action);

      const result = options.feature.reduce(options.state.get(state), selected.value);
      const parent = self.reduce(options.state.replace(result.state, state), action);

      return {
        state: parent.state,
        commands: [
          ...(result.commands ?? []).map((command) =>
            rebase(command, [options.action.key], options.action.embed),
          ),
          ...(parent.commands ?? []),
        ],
      };
    },
  });

/**
 * Optional state with an explicit action route. `identity` defaults to one identity
 * per presentation; supply it when replacing a present child must end its old work.
 * @category models
 * @since 0.1.0-beta.0
 */
export interface OptionalChild<S, A, CS, CA, CR> {
  readonly state: Optic.Lens<S, Option.Option<CS>>;
  readonly action: Route<A, CA>;
  readonly feature: Definition<CS, CA, CR>;
  readonly identity?: (state: CS) => string;
}

/**
 * Composes an optional child. Removal or identity replacement cancels its work.
 * An external child action while absent throws StoreError; obsolete command actions
 * are discarded by the store before reaching the reducer.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export const optionalChild =
  <S, A, CS, CA, CR>(options: OptionalChild<S, A, CS, CA, CR>) =>
  <R>(self: Definition<S, A, R>): Definition<S, A, R | CR> => {
    const path = (state: CS) => [options.action.key, options.identity?.(state) ?? "present"];

    return {
      ...self,
      routes: register(self, options.action.key),
      lifetimes: (state) => {
        const selected = options.state.get(state);

        return [
          ...self.lifetimes(state),
          ...(Option.isSome(selected)
            ? options.feature
                .lifetimes(selected.value)
                .map((tail) => [...path(selected.value), ...tail])
            : []),
        ];
      },
      reduce: (state, action) => {
        const selected = options.action.extract(action);

        if (Option.isNone(selected)) return self.reduce(state, action);

        const current = options.state.get(state);

        if (Option.isNone(current))
          throw StoreError.make({
            reason: "MissingChild",
            message: `Child ${options.action.key} is absent`,
          });

        const result = options.feature.reduce(current.value, selected.value);
        const parent = self.reduce(options.state.replace(Option.some(result.state), state), action);

        return {
          state: parent.state,
          commands: [
            ...(result.commands ?? []).map((command) =>
              rebase(command, path(current.value), options.action.embed),
            ),
            ...(parent.commands ?? []),
          ],
        };
      },
    };
  };

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
 * Composes a map of independent children. Removed IDs lose their command lifetime.
 * Map iteration order does not affect identity. Treat maps and entries as immutable.
 * @category combinators
 * @since 0.1.0-beta.0
 */
export const forEach =
  <S, A, CS, CA, CR>(options: {
    readonly state: Optic.Lens<S, ReadonlyMap<string, CS>>;
    readonly action: Route<A, Identified<CA>>;
    readonly feature: Definition<CS, CA, CR>;
  }) =>
  <R>(self: Definition<S, A, R>): Definition<S, A, R | CR> => ({
    ...self,
    routes: register(self, options.action.key),
    lifetimes: (state) => [
      ...self.lifetimes(state),
      ...Array.from(options.state.get(state), ([id, value]) =>
        options.feature.lifetimes(value).map((path) => [options.action.key, id, ...path]),
      ).flat(),
    ],
    reduce: (state, action) => {
      const selected = options.action.extract(action);

      if (Option.isNone(selected)) return self.reduce(state, action);

      const { id, action: childAction } = selected.value;
      const entries = options.state.get(state);

      if (!entries.has(id))
        throw StoreError.make({
          reason: "MissingChild",
          message: `Child ${options.action.key}/${id} is absent`,
        });

      // Map.has above distinguishes a missing entry from a valid undefined state.
      const result = options.feature.reduce(entries.get(id) as CS, childAction);
      const updated = new Map(entries);

      updated.set(id, result.state);

      const parent = self.reduce(options.state.replace(updated, state), action);

      return {
        state: parent.state,
        commands: [
          ...(result.commands ?? []).map((command) =>
            rebase(command, [options.action.key, id], (child) =>
              options.action.embed({ id, action: child }),
            ),
          ),
          ...(parent.commands ?? []),
        ],
      };
    },
  });
