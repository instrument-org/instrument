/** How deep data copied off an error is kept, as Sentry's extraErrorData does. */
export const NORMALIZE_DEPTH = 3;

const MAX_PROPERTIES = 100;
const MAX_STRING_LENGTH = 16_000;

/**
 * A JSON-safe, structured-clone-safe copy of any value, `depth` levels deep:
 * what survives `JSON.stringify` and a trip over IPC unchanged. Cycles,
 * functions, symbols, bigints and anything past the depth become a short
 * bracketed description, an `Error` its `name: message`, and a value with
 * `toJSON` what that returns. Long strings and wide objects are cut.
 */
export function normalize(value: unknown, depth = NORMALIZE_DEPTH): unknown {
  return visit(value, depth, new WeakSet());
}

function visit(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : `[${String(value)}]`;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (value === undefined) {
    return "[undefined]";
  }
  if (typeof value === "bigint") {
    return `[BigInt: ${value.toString()}]`;
  }
  if (typeof value === "symbol") {
    return `[${value.toString()}]`;
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "<anonymous>"}]`;
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (seen.has(value)) {
    return "[Circular ~]";
  }
  if (isErrorLike(value)) {
    return `${value.name}: ${value.message}`;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "[Invalid Date]"
      : value.toISOString();
  }
  if (value instanceof RegExp || value instanceof URL) {
    return value.toString();
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.constructor.name}(${value.byteLength} bytes)]`;
  }
  if (hasToJSON(value)) {
    try {
      return visit(value.toJSON(), depth, seen);
    } catch {
      // A toJSON that throws is described like any other object.
    }
  }
  if (depth <= 0) {
    return Array.isArray(value) ? "[Array]" : `[${className(value)}]`;
  }

  seen.add(value);
  try {
    if (Array.isArray(value) || value instanceof Set) {
      const items: unknown[] = [...value];
      const copy = items
        .slice(0, MAX_PROPERTIES)
        .map((item) => visit(item, depth - 1, seen));
      if (items.length > MAX_PROPERTIES) {
        copy.push(`[${items.length - MAX_PROPERTIES} more]`);
      }
      return copy;
    }
    const entries =
      value instanceof Map
        ? [...value.entries()].map(([key, item]): [string, unknown] => [
            String(key),
            item,
          ])
        : ownEntries(value);
    const copy: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_PROPERTIES)) {
      copy[key] = visit(item, depth - 1, seen);
    }
    if (entries.length > MAX_PROPERTIES) {
      copy["[more]"] = `${entries.length - MAX_PROPERTIES} more properties`;
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function ownEntries(value: object): [string, unknown][] {
  return Object.keys(value).map((key): [string, unknown] => {
    try {
      return [key, Reflect.get(value, key)];
    } catch {
      return [key, "[unreadable]"];
    }
  });
}

/** An `Error` from this realm or another one (a worker, a frame). */
export function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === "object" &&
      value !== null &&
      Object.prototype.toString.call(value) === "[object Error]")
  );
}

export function className(value: object): string {
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === null) {
      return "Object";
    }
    const constructor: unknown =
      typeof prototype === "object"
        ? Reflect.get(prototype, "constructor")
        : undefined;
    const name: unknown =
      typeof constructor === "function" ? constructor.name : undefined;
    return typeof name === "string" && name ? name : "Object";
  } catch {
    return "Object";
  }
}

function hasToJSON(value: object): value is { toJSON: () => unknown } {
  return "toJSON" in value && typeof value.toJSON === "function";
}
