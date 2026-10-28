const MAX_CAUSE_DEPTH = 5;

/**
 * The `cause` chain under an error, one line: each link's name, message and
 * `code`, outermost first. An SDK error's own message often says only which
 * step failed ("Failed to process successful response"); what failed under it
 * (`TypeError: terminated`, `SocketError: other side closed`) is on the cause,
 * which the transcript keeps by this. Undefined when there is no cause.
 */
export function describeErrorCause(error: unknown): string | undefined {
  const links: string[] = [];
  let current = error instanceof Error ? error.cause : undefined;
  while (current !== undefined && links.length < MAX_CAUSE_DEPTH) {
    links.push(describeLink(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return links.length > 0 ? links.join(", caused by ") : undefined;
}

function describeLink(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return typeof cause === "string" ? cause : JSON.stringify(cause);
  }
  const code =
    "code" in cause && typeof cause.code === "string" ? ` (${cause.code})` : "";
  return `${cause.name}: ${cause.message}${code}`;
}
