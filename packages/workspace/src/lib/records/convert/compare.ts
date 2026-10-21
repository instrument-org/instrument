import { inspect } from "node:util";

/**
 * Where what a chat's records read back differs from what `chat.db` held,
 * field by field. Two values are the same when:
 *
 * - Both are missing: a field that is `undefined`, and a number JSON cannot
 *   hold (`NaN`, `Infinity`, which a record leaves out), is no field.
 * - Both are dates for the same instant, or one is a date and the other its
 *   ISO string, which is how a date inside a tool's output or a told value
 *   reads back from a record.
 * - Both are arrays, or plain objects, whose items are the same.
 *
 * Anything else that is not a plain object (a `Map`, a `Set`) is the same
 * only as one of its own kind with the same contents, so one that a record
 * cannot hold shows up as a difference rather than an empty object.
 *
 * Reading a date and its ISO string as the same value is what a format
 * without superjson costs, and it is the one change this comparison is
 * specified not to see, so it cannot stand alone as the gate: a reader that
 * forgets to turn its string back into a date is exactly this difference.
 * `datesKept` answers that question separately.
 */

export interface Difference {
  /** What `chat.db` held there, shortened; absent where it held nothing. */
  old?: string;
  /** What the records hold there, or why they hold nothing. */
  now?: string;
  /** Where in the chat: the session, message and part ids, then the field. */
  path: string;
}

/** How many differences one chat reports, which is enough to tell why. */
export const MAX_DIFFERENCES = 50;

const SHOWN_CHARACTERS = 200;

/** Adds every difference between `old` and `now` under `path` to `found`. */
export function addDifferences(
  found: Difference[],
  path: string,
  old: unknown,
  now: unknown,
): void {
  if (found.length >= MAX_DIFFERENCES || (isAbsent(old) && isAbsent(now))) {
    return;
  }
  if (old instanceof Date || now instanceof Date) {
    if (!sameInstant(old, now)) {
      addDifference(found, path, old, now);
    }
    return;
  }
  const left = comparable(old);
  const right = comparable(now);
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      addDifference(found, `${path}.length`, left.length, right.length);
    }
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      addDifferences(found, `${path}[${index}]`, left[index], right[index]);
    }
    return;
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].toSorted()) {
      addDifferences(found, `${path}.${key}`, left[key], right[key]);
    }
    return;
  }
  if (left !== right) {
    addDifference(found, path, old, now);
  }
}

/**
 * Where `chat.db` held a date and the records read back something that is
 * not one, which `addDifferences` reads as the same value.
 *
 * For a value a schema has already read back, which is what makes the answer
 * mean anything: a part, once `partFromRecord` has run.
 */
export function datesKept(
  found: Difference[],
  path: string,
  old: unknown,
  now: unknown,
): void {
  if (found.length >= MAX_DIFFERENCES) {
    return;
  }
  if (old instanceof Date) {
    if (!(now instanceof Date)) {
      addDifference(found, `${path} <date became`, old, now);
    }
    return;
  }
  if (Array.isArray(old) && Array.isArray(now)) {
    for (let index = 0; index < old.length; index++) {
      datesKept(found, `${path}[${index}]`, old[index], now[index]);
    }
    return;
  }
  if (isPlainObject(old) && isPlainObject(now)) {
    for (const key of Object.keys(old).toSorted()) {
      datesKept(found, `${path}.${key}`, old[key], now[key]);
    }
  }
}

export function addDifference(
  found: Difference[],
  path: string,
  old: unknown,
  now: unknown,
): void {
  if (found.length >= MAX_DIFFERENCES) {
    return;
  }
  const shownOld = shown(old);
  const shownNow = shown(now);
  found.push({
    path,
    ...(shownOld === undefined ? {} : { old: shownOld }),
    ...(shownNow === undefined ? {} : { now: shownNow }),
  });
}

function isAbsent(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

function sameInstant(old: unknown, now: unknown): boolean {
  const instant = (value: unknown) =>
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  const left = instant(old);
  return !Number.isNaN(left) && left === instant(now);
}

/**
 * A value that is not a plain object or array as a plain object naming its
 * kind, so it compares only with its own kind.
 */
function comparable(value: unknown): unknown {
  if (value instanceof Map) {
    return { "<Map>": [...value.entries()] };
  }
  if (value instanceof Set) {
    return { "<Set>": [...value] };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isPlainObject(value)
  ) {
    return {
      [`<${Object.prototype.toString.call(value).slice(8, -1)}>`]: inspect(
        value,
        { depth: null, maxArrayLength: null, maxStringLength: null },
      ),
    };
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function shown(value: unknown): string | undefined {
  if (isAbsent(value)) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }
  let text: string;
  try {
    text = JSON.stringify(comparable(value)) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > SHOWN_CHARACTERS
    ? `${text.slice(0, SHOWN_CHARACTERS)}…`
    : text;
}
