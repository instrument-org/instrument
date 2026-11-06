import { type SessionMessage } from "@instrument-org/workspace/client";

/**
 * Whether a reply failed in a way its turn went on past, with another of the
 * agent's messages after it, which is the retry: a throttle, a provider's
 * passing problem, or a refusal of media the retry left out (`refusedMedia`),
 * which the agent tells the person about itself. The transcript leaves out
 * its error and the words it got out before failing, since the retry says
 * them whole. A failure the turn ended on was never
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
