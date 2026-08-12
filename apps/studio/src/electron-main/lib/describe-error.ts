import { inspect } from "node:util";

/**
 * Say what an unknown throw was, in terms a person can read.
 *
 * Anything can be thrown, and the values that are not `Error`s are the ones
 * that need the care: a provider reporting a rejection as a bare object, a
 * promise rejected with a string. `String(value)` renders the first of those
 * as `[object Object]`, which names neither the failure nor where it came
 * from.
 *
 * `message` is the single line worth leading with, and prefers the value's own
 * `message` to a serialization of the whole thing. `details` is the long form
 * kept beside it: a stack for an `Error`, the serialized value for anything
 * else, and absent when `message` already is that serialization.
 */
export function describeError(error: unknown): {
  details?: string;
  message: string;
} {
  if (error instanceof Error) {
    // A subclass can leave `message` empty, and the class name is still an
    // answer.
    return { details: error.stack, message: error.message || error.name };
  }

  // A thrown string is already the sentence; serializing only adds quotes.
  if (typeof error === "string" && error.length > 0) {
    return { message: error };
  }

  // `inspect` rather than `JSON.stringify`, which throws on a cycle and
  // returns nothing at all for a function or a symbol.
  const serialized = inspect(error, { breakLength: 120, depth: 4 });
  const message = ownMessage(error);

  return message === undefined
    ? { message: serialized }
    : { details: serialized, message };
}

/**
 * The sentence a non-`Error` carries, if it carries one.
 *
 * `message` is where the AI SDK, ORPC, and the providers we proxy all put it.
 * `error` is the other convention, from APIs whose whole body is the sentence.
 */
function ownMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return;
  }
  if (
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  if ("error" in error && typeof error.error === "string" && error.error) {
    return error.error;
  }
  return;
}
