import { type SessionMessage } from "@instrument-org/workspace/client";

/**
 * Whether the message at `index` is the turn's latest attempt at an answer: the
 * last message, or the one just before an attempt that hasn't said anything yet.
 * A retry is a new message from the moment it starts, well before it has anything
 * to show, and what the attempt above it says stands until then.
 */
export function isLatestAttempt(
  messages: readonly SessionMessage.WithParts[],
  index: number,
): boolean {
  if (index === messages.length - 1) {
    return true;
  }
  const next = messages[index + 1];
  return (
    index === messages.length - 2 &&
    next?.role === "assistant" &&
    !next.metadata.error &&
    next.parts.every((part) => part.type === "step-start")
  );
}

/**
 * Whether a reply failed in a way its turn went on past, with another of the
 * agent's messages after it, which is the retry: a throttle, a provider's
 * passing problem, or a refusal of media the retry left out (`refusedMedia`),
 * which the agent tells the person about itself. Outside developer mode the
 * transcript leaves out its error and the words it got out before failing,
 * since the retry says them whole. A failure the turn ended on was never
 * retried, and stays.
 */
export function isRetriedAway(
  {
    error,
    refusedMedia,
  }: Pick<SessionMessage.Assistant["metadata"], "error" | "refusedMedia">,
  { endedTurn, isLastMessage }: { endedTurn: boolean; isLastMessage: boolean },
): boolean {
  const classification =
    error && "classification" in error ? error.classification : undefined;
  return (
    (classification === "rate-limit" ||
      classification === "transient" ||
      (refusedMedia?.length ?? 0) > 0) &&
    !isLastMessage &&
    !endedTurn
  );
}
