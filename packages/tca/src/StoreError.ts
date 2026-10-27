/**
 * Observable store and assertion failures.
 * @since 0.0.1
 */
import * as Schema from "effect/Schema";

/**
 * The store is closed, a reducer or effect failed, or a TestStore assertion failed.
 * `cause` retains the original failure for local diagnostics.
 * @category errors
 * @since 0.0.1
 */
export class StoreError extends Schema.TaggedError<StoreError, { readonly brand: unique symbol }>()(
  "StoreError",
  {
    reason: Schema.Literals(["Closed", "Reducer", "Effect", "Assertion", "MissingChild"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
