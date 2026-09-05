// undici (Node's fetch) collapses every low-level connection failure into a
// `TypeError: fetch failed`, hiding the real reason (DNS, timeout, refused,
// offline) on the nested `cause`. To classify these we have to walk the cause
// chain rather than inspect the top-level error.

// undici surfaces dropped connections / aborted bodies as a bare TypeError
// whose message is one of these, with no informative cause to inspect.
const FETCH_FAILURE_MESSAGES = new Set(["fetch failed", "terminated"]);

const NETWORK_ERROR_NAMES = new Set([
  "BodyTimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "SocketError",
]);

const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const MAX_CAUSE_DEPTH = 10;

/**
 * Detects "can't reach the server" failures (timeouts, DNS, refused
 * connections, offline) by walking the `cause` chain. These are a property of
 * the user's network rather than a bug, so callers can treat them as expected
 * control flow instead of reportable exceptions.
 */
export function isExpectedNetworkError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      break;
    }

    if (
      current instanceof TypeError &&
      FETCH_FAILURE_MESSAGES.has(current.message)
    ) {
      return true;
    }

    if (NETWORK_ERROR_NAMES.has(current.name)) {
      return true;
    }

    const code = getErrorCode(current);
    if (code && NETWORK_ERROR_CODES.has(code)) {
      return true;
    }

    current = current.cause;
  }

  return false;
}

function getErrorCode(error: Error): string | undefined {
  return "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
