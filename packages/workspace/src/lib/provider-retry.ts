/**
 * The longest a provider may ask a turn to wait before its next attempt. A
 * longer ask is a limit the person should hear about rather than wait through
 * with nothing on screen, so the turn ends with the error instead.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/** The longest wait between attempts when the provider names none. */
const MAX_BACKOFF_MS = 10_000;

/**
 * How much of a computed wait is taken off at random, so turns that failed
 * together do not all ask again at the same moment. Only ever shortened, so
 * the base delay stays an upper bound on the first wait.
 */
const JITTER_RATIO = 0.1;

export interface ProviderRetryHeaders {
  /** How long the provider asked to wait, from `retry-after-ms` or `retry-after`. */
  retryAfterMs?: number;
  /** The provider's own verdict on retrying, from `x-should-retry`. */
  shouldRetry?: boolean;
}

/**
 * Read what a failed response's headers say about trying again. OpenAI and
 * Anthropic send `x-should-retry` and `retry-after-ms`; `retry-after` is the
 * HTTP header, in seconds or as a date.
 */
export function readRetryHeaders(
  headers: Record<string, string> | undefined,
  now = Date.now(),
): ProviderRetryHeaders {
  if (headers === undefined) {
    return {};
  }
  const header = (name: string) =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

  const shouldRetryValue = header("x-should-retry");
  const shouldRetry =
    shouldRetryValue === "true"
      ? true
      : shouldRetryValue === "false"
        ? false
        : undefined;

  return {
    ...(shouldRetry !== undefined && { shouldRetry }),
    ...retryAfter(header("retry-after-ms"), header("retry-after"), now),
  };
}

function retryAfter(
  milliseconds: string | undefined,
  value: string | undefined,
  now: number,
): Pick<ProviderRetryHeaders, "retryAfterMs"> {
  const fromMilliseconds = Number.parseFloat(milliseconds ?? "");
  if (Number.isFinite(fromMilliseconds) && fromMilliseconds >= 0) {
    return { retryAfterMs: fromMilliseconds };
  }
  if (value === undefined) {
    return {};
  }
  const seconds = Number.parseFloat(value);
  const fromValue = Number.isNaN(seconds)
    ? Date.parse(value) - now
    : seconds * 1000;
  return Number.isFinite(fromValue)
    ? { retryAfterMs: Math.max(0, fromValue) }
    : {};
}

/**
 * How long to wait before the next attempt: what the provider asked for when
 * it named a wait, and otherwise the base delay doubled per retry up to
 * `MAX_BACKOFF_MS`, less a little at random.
 */
export function retryDelayMs({
  baseMs,
  random = Math.random,
  retryAfterMs,
  retryCount,
}: {
  baseMs: number;
  random?: () => number;
  retryAfterMs: number | undefined;
  /** 1 for the first retry. */
  retryCount: number;
}): number {
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  const backoff = Math.min(
    baseMs * 2 ** Math.max(0, retryCount - 1),
    Math.max(baseMs, MAX_BACKOFF_MS),
  );
  return backoff * (1 - random() * JITTER_RATIO);
}
