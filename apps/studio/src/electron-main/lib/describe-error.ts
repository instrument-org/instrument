import { inspect } from "node:util";

// Deep enough for a throw wrapped on its way up through a couple of layers,
// short enough that a self-referencing chain cannot fill a report.
const MAX_CAUSE_DEPTH = 5;

/**
 * What lies under a throw, named but not quoted.
 *
 * A wrapper says what we were doing; the throw it caught says what happened,
 * and only the second one separates a permission error from a disk that went
 * away. So each link is identified by its class, its typed-error discriminator,
 * and its code -- never by its message, which for a filesystem error is the
 * path it failed on and for a validation error is the value that failed. This
 * goes into exception reports, and what a report is owed is the shape of the
 * failure, not its contents.
 *
 * Undefined when the throw wrapped nothing, which is most of them.
 */
export function describeCauses(error: unknown): string | undefined {
  const chain: string[] = [];
  const seen = new Set<unknown>();
  let cause: unknown = error instanceof Error ? error.cause : undefined;

  while (
    cause !== undefined &&
    cause !== null &&
    chain.length < MAX_CAUSE_DEPTH &&
    !seen.has(cause)
  ) {
    seen.add(cause);
    chain.push(identifyThrown(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }

  return chain.length > 0 ? chain.join(" <- ") : undefined;
}

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
 * One link of the chain above: the most specific name the throw answers to,
 * qualified by its code where it has one -- `Error(EACCES)`,
 * `workspace-filesystem-error`, `ORPCError(FILE_SYSTEM_ERROR)`, `RangeError`.
 */
function identifyThrown(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error;
  }

  // Our typed errors put what they are in `type`; their class name is the
  // vaguer half of the same answer (`FileSystem`), and `name` is plain `Error`.
  const label =
    "type" in error && typeof error.type === "string"
      ? error.type
      : error.constructor.name;
  // An errno from Node, a string code from ORPC, an HTTP status from a
  // provider.
  const code =
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : undefined;

  return code === undefined ? label : `${label}(${code})`;
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
