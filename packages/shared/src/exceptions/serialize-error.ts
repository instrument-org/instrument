import {
  className,
  isErrorLike,
  normalize,
  NORMALIZE_DEPTH,
} from "./normalize";
import { type SerializedError } from "./schema";

/** How many errors one capture follows, the captured one included. */
export const LINKED_ERROR_LIMIT = 10;

// Read by the event itself (type, value, stack) or followed as links, so not
// copied into an error's data. The rest is what extraErrorData leaves out.
const NATIVE_KEYS = new Set([
  "column",
  "columnNumber",
  "fileName",
  "line",
  "lineNumber",
  "message",
  "name",
  "stack",
  "toJSON",
]);

// The capture functions a synthetic stack is taken inside of, dropped from
// its innermost end so it starts where the value was captured.
const CAPTURE_FRAMES =
  /serializeError|captureException|captureServerException|captureRendererException|buildExceptionEvent/;

/**
 * Reduce anything thrown to a `SerializedError`: an Error's type, message,
 * stack and own enumerable properties (and what its `toJSON` adds), then its
 * `cause`, an AggregateError's `errors` and a SuppressedError's `error` and
 * `suppressed`, as far as `LINKED_ERROR_LIMIT` errors in all. A thrown value
 * that is not an Error becomes a synthetic one, with a message saying what it
 * was, the value itself in `data.__serialized__`, and the stack where it was
 * captured.
 */
export function serializeError(error: unknown): SerializedError {
  const budget = { left: LINKED_ERROR_LIMIT };
  if (isErrorLike(error)) {
    return serializeErrorObject(error, budget);
  }
  const fromProperty = errorProperty(error);
  if (fromProperty) {
    const serialized = serializeErrorObject(fromProperty, budget);
    return {
      ...serialized,
      data: { ...serialized.data, __serialized__: normalize(error) },
    };
  }
  budget.left--;
  return {
    ...(typeof error === "object" &&
      error !== null && { data: { __serialized__: normalize(error) } }),
    stack: syntheticStack(),
    synthetic: true,
    type: "Error",
    value: describeNonError(error),
  };
}

function serializeErrorObject(
  error: Error,
  budget: { left: number },
): SerializedError {
  budget.left--;
  const data = errorData(error);
  const links: { error: SerializedError; source: string }[] = [];
  const follow = (child: unknown, source: string) => {
    if (budget.left > 0 && isErrorLike(child)) {
      links.push({ error: serializeErrorObject(child, budget), source });
    }
  };

  follow(readProperty(error, "cause"), "cause");
  const errors = readProperty(error, "errors");
  if (Array.isArray(errors)) {
    errors.forEach((child: unknown, index) => {
      follow(child, `errors[${index}]`);
    });
  }
  if ("error" in error && "suppressed" in error) {
    follow(error.error, "error");
    follow(error.suppressed, "suppressed");
  }

  const cause = readProperty(error, "cause");
  if (cause !== undefined && !isErrorLike(cause)) {
    data.cause = normalize(cause, NORMALIZE_DEPTH - 1);
  }

  return {
    ...(Object.keys(data).length > 0 && { data }),
    ...(links.length > 0 && { links }),
    ...(typeof error.stack === "string" && { stack: error.stack }),
    type: errorType(error),
    value: typeof error.message === "string" ? error.message : "",
  };
}

/** An error's own enumerable properties and its `toJSON`, normalized. */
function errorData(error: Error): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(error)) {
    if (NATIVE_KEYS.has(key)) {
      continue;
    }
    const value = readProperty(error, key);
    // A link is followed as an exception of its own.
    if (
      (key === "cause" || key === "error" || key === "suppressed") &&
      isErrorLike(value)
    ) {
      continue;
    }
    if (key === "errors" && Array.isArray(value)) {
      continue;
    }
    data[key] = normalize(value, NORMALIZE_DEPTH - 1);
  }
  const toJSON = readProperty(error, "toJSON");
  if (typeof toJSON === "function") {
    try {
      const serialized: unknown = toJSON.call(error);
      if (typeof serialized === "object" && serialized !== null) {
        for (const [key, value] of Object.entries(serialized)) {
          if (!NATIVE_KEYS.has(key) && !(key in data)) {
            data[key] = normalize(value, NORMALIZE_DEPTH - 1);
          }
        }
      }
    } catch {
      // A toJSON that throws adds nothing.
    }
  }
  return data;
}

function errorType(error: Error): string {
  const name = readProperty(error, "name");
  return typeof name === "string" && name ? name : className(error);
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

/** A plain object's first own property that is an Error, as Sentry takes it. */
function errorProperty(value: unknown): Error | undefined {
  if (typeof value !== "object" || value === null || isErrorLike(value)) {
    return undefined;
  }
  if (className(value) !== "Object") {
    return undefined;
  }
  for (const key of Object.keys(value)) {
    const property = readProperty(value, key);
    if (isErrorLike(property)) {
      return property;
    }
  }
  return undefined;
}

/** The message a synthetic exception carries, as Sentry words it. */
function describeNonError(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return `Non-Error exception captured with value: ${String(value)}`;
  }
  const name = readProperty(value, "name");
  const message = readProperty(value, "message");
  if (typeof name === "string") {
    return typeof message === "string"
      ? `'${name}' captured as exception with message '${message}'`
      : `'${name}' captured as exception`;
  }
  if (typeof message === "string") {
    return message;
  }
  const kind = className(value);
  const label = kind === "Object" ? "Object" : `'${kind}'`;
  return `${label} captured as exception with keys: ${keysForMessage(value)}`;
}

/** The keys of an object, sorted and cut to about 40 characters. */
function keysForMessage(value: object): string {
  const keys = Object.keys(value).sort();
  if (keys.length === 0) {
    return "[object has no keys]";
  }
  let text = "";
  for (const key of keys) {
    const next = text ? `${text}, ${key}` : key;
    if (next.length > 40) {
      return text ? `${text}…` : `${key.slice(0, 40)}…`;
    }
    text = next;
  }
  return text;
}

function syntheticStack(): string | undefined {
  const { stack } = new Error("synthetic");
  if (!stack) {
    return undefined;
  }
  const lines = stack.split("\n");
  // Drop the synthetic error's own heading and the capture functions it was
  // made in, so the first frame is the caller that captured the value.
  let start = 1;
  while (start < lines.length && CAPTURE_FRAMES.test(lines[start] ?? "")) {
    start++;
  }
  return ["Error", ...lines.slice(start)].join("\n");
}
