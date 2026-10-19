import { type Breadcrumb, normalize } from "@instrument-org/shared/exceptions";

/** How many breadcrumbs an event carries: the last this many, as Sentry keeps. */
const MAX_BREADCRUMBS = 100;

/** How long one breadcrumb's message may be. */
const MAX_MESSAGE_LENGTH = 500;

const crumbs: Breadcrumb[] = [];

/**
 * Note something that happened, for the next captured exception to carry:
 * a log line, an RPC call and how it went. Kept in memory, the last
 * `MAX_BREADCRUMBS` of them.
 */
function addBreadcrumb({
  timestamp = Date.now(),
  ...crumb
}: Omit<Breadcrumb, "timestamp"> & { timestamp?: number }) {
  crumbs.push({
    ...crumb,
    message:
      crumb.message.length > MAX_MESSAGE_LENGTH
        ? `${crumb.message.slice(0, MAX_MESSAGE_LENGTH)}…`
        : crumb.message,
    timestamp,
  });
  if (crumbs.length > MAX_BREADCRUMBS) {
    crumbs.splice(0, crumbs.length - MAX_BREADCRUMBS);
  }
}

/** The breadcrumbs so far, oldest first. */
export function recentBreadcrumbs(): readonly Breadcrumb[] {
  return crumbs.slice();
}

/**
 * An electron-log transport that turns every line logged at `info` or above
 * into a breadcrumb, scoped lines under `log.<scope>`.
 */
export function breadcrumbLogTransport(message: {
  data: unknown[];
  level: string;
  scope?: string;
}) {
  addBreadcrumb({
    category: message.scope ? `log.${message.scope}` : "log",
    level: message.level,
    message: message.data.map(logPart).join(" "),
  });
}

function logPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  const normalized = normalize(part, 2);
  return typeof normalized === "string"
    ? normalized
    : JSON.stringify(normalized);
}

// A live subscription or event stream opens once and stays open, so its
// opening says little; it is noted only when it fails.
const STREAM_SEGMENTS = new Set(["events", "live"]);

/**
 * An oRPC interceptor that notes each procedure call with how it ended and
 * how long it took.
 */
export async function breadcrumbRPC<T>(options: {
  next: () => Promise<T>;
  path: readonly string[];
}): Promise<T> {
  const startedAt = performance.now();
  const path = options.path.join(".");
  const took = () => Math.round(performance.now() - startedAt);
  try {
    const result = await options.next();
    if (!options.path.some((segment) => STREAM_SEGMENTS.has(segment))) {
      addBreadcrumb({
        category: "rpc",
        data: { durationMs: took(), path },
        level: "info",
        message: `${path} ok`,
      });
    }
    return result;
  } catch (error) {
    addBreadcrumb({
      category: "rpc",
      data: { durationMs: took(), path },
      level: "error",
      message: `${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}
