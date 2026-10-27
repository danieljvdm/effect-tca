/**
 * Observable store and assertion failures.
 * @since 0.1.0-beta.0
 */
import * as Schema from "effect/Schema";

/**
 * The store is closed, a reducer or command failed, or a TestStore assertion failed.
 * `cause` retains the original failure for local diagnostics.
 * @category errors
 * @since 0.1.0-beta.0
 */
export class StoreError extends Schema.TaggedError<StoreError, { readonly brand: unique symbol }>()(
  "StoreError",
  {
    reason: Schema.Literals(["Closed", "Reducer", "Command", "Assertion", "MissingChild"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
