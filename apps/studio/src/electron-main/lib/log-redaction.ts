import type { LogMessage, NodeLogger } from "electron-log";

import {
  redactSecrets,
  redactUrlQueries,
} from "@instrument-org/shared/secrets";

/** How deep into a logged object its strings are redacted. */
const MAX_DEPTH = 6;

/**
 * Keep secrets and web addresses' queries out of every line logged, before
 * any transport sees it: the log file on disk, the terminal, and the
 * breadcrumbs an error report carries. A line is redacted once and the same
 * copy handed to every transport, so a later hook that remembers lines by
 * identity sees one line, not one per transport.
 */
export function redactLogger(logger: NodeLogger) {
  const redacted = new WeakMap<LogMessage, LogMessage>();
  logger.hooks.push((message) => {
    let copy = redacted.get(message);
    if (!copy) {
      const data: unknown[] = message.data;
      copy = { ...message, data: data.map((part) => redactPart(part, 0)) };
      redacted.set(message, copy);
    }
    return copy;
  });
}

function redactText(text: string) {
  return redactUrlQueries(redactSecrets(text));
}

/**
 * A logged value with its strings redacted: a string, an error's message,
 * stack and cause, and the strings of a plain object or array. Anything else
 * goes through as it was.
 */
function redactPart(part: unknown, depth: number): unknown {
  if (typeof part === "string") {
    return redactText(part);
  }
  if (depth >= MAX_DEPTH || typeof part !== "object" || part === null) {
    return part;
  }
  if (part instanceof Error) {
    const prototype: unknown = Object.getPrototypeOf(part);
    const copy: unknown = Object.create(
      typeof prototype === "object" ? prototype : null,
    );
    if (!(copy instanceof Error)) {
      return part;
    }
    Object.defineProperties(copy, Object.getOwnPropertyDescriptors(part));
    copy.message = redactText(part.message);
    if (part.stack) {
      // V8's `stack` is an accessor reading the original error's own slot,
      // so the copy gets the text as a plain property instead.
      Object.defineProperty(copy, "stack", {
        configurable: true,
        value: redactText(part.stack),
        writable: true,
      });
    }
    if (part.cause !== undefined) {
      copy.cause = redactPart(part.cause, depth + 1);
    }
    return copy;
  }
  if (Array.isArray(part)) {
    return part.map((item: unknown) => redactPart(item, depth + 1));
  }
  const prototype: unknown = Object.getPrototypeOf(part);
  if (prototype !== Object.prototype && prototype !== null) {
    return part;
  }
  return Object.fromEntries(
    Object.entries(part).map(([key, value]) => [
      key,
      redactPart(value, depth + 1),
    ]),
  );
}
