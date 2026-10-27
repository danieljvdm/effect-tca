import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import type * as Scope from "effect/Scope";

import * as FeatureEffect from "../FeatureEffect.ts";

const none: FeatureEffect.None = { _tag: "None" };

type Body<Cases extends Record<string, Schema.Constraint>, R> = (
  send: FeatureEffect.Senders<Cases>,
) => Effect.Effect<void, never, R> | Generator<Effect.Effect<unknown, never, R>, void, never>;

const createSenderFactory = <Cases extends Record<string, Schema.Constraint>>(
  schema: Schema.TaggedUnion<Cases>,
): ((send: FeatureEffect.Send<Cases[keyof Cases]["Type"]>) => FeatureEffect.Senders<Cases>) => {
  const factories = Object.keys(schema.cases).map((tag) => {
    // Cache each case's constructor once, while keeping payload validation lazy.
    const makeAction = SchemaParser.makeEffect(schema.cases[tag as keyof Cases]);

    return [
      tag,
      (send: FeatureEffect.Send<Cases[keyof Cases]["Type"]>) =>
        (payload: object = {}) =>
          Effect.suspend(() =>
            Effect.flatMap(Effect.orDie(makeAction({ ...payload, _tag: tag })), send),
          ),
    ] as const;
  });

  return (send) =>
    // Object.fromEntries erases the mapped action keys and payload signatures.
    Object.fromEntries<unknown>(
      factories.map(([tag, makeSender]) => [tag, makeSender(send)]),
    ) as FeatureEffect.Senders<Cases>;
};

/** One context and cancellation identity per case, shared across reducer calls. */
export const createEffectContexts = <Cases extends Record<string, Schema.Constraint>>(
  schema: Schema.TaggedUnion<Cases>,
): { readonly [K in keyof Cases]: FeatureEffect.Context<Cases> } => {
  const createSenders = createSenderFactory(schema);

  const keys = new Map<keyof Cases, symbol>(
    Object.keys(schema.cases).map((tag) => [tag, Symbol(tag)]),
  );

  const createRun = (key?: FeatureEffect.CancellationKey): FeatureEffect.Context<Cases>["run"] => {
    function run<Yield extends Effect.Effect<unknown, never, unknown>>(
      body: (send: FeatureEffect.Senders<Cases>) => Generator<Yield, void, never>,
    ): FeatureEffect.Run<Cases[keyof Cases]["Type"], Exclude<Effect.Services<Yield>, Scope.Scope>>;
    function run<R>(
      body: (send: FeatureEffect.Senders<Cases>) => Effect.Effect<void, never, R>,
    ): FeatureEffect.Run<Cases[keyof Cases]["Type"], Exclude<R, Scope.Scope>>;
    function run<R>(body: Body<Cases, R>): FeatureEffect.Run<Cases[keyof Cases]["Type"], R> {
      return {
        _tag: "Run",
        key,
        run: (send) =>
          Effect.suspend(() => {
            const result = body(createSenders(send));

            return Effect.isEffect(result) ? result : Effect.gen(() => result);
          }),
        path: [],
      };
    }

    return run;
  };

  const run = createRun();

  const cancel = (tag: keyof Cases): FeatureEffect.Cancel => {
    const key = keys.get(tag);

    if (key === undefined) throw new Error(`Unknown action case: ${String(tag)}`);

    return FeatureEffect.cancel({ cancellationKey: key });
  };

  // Object.fromEntries erases the keys retained by the schema's case record.
  return Object.fromEntries(
    Array.from(keys, ([tag, key]) => [
      tag,
      {
        none,
        run,
        replace: createRun(key),
        cancel,
      } satisfies FeatureEffect.Context<Cases>,
    ]),
  ) as { readonly [K in keyof Cases]: FeatureEffect.Context<Cases> };
};
