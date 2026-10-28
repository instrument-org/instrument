import { type SessionMessage } from "@instrument-org/workspace/client";

type MessageError = NonNullable<SessionMessage.Assistant["metadata"]["error"]>;

/**
 * Whether a reply failed in a way its turn went on past: a throttle or a
 * provider's passing problem, with another of the agent's messages after it,
 * which is the retry. Outside developer mode the transcript leaves out its
 * error and the words it got out before failing, since the retry says them
 * whole. A failure the turn ended on was never retried, and stays.
 */
export function isRetriedAway(
  error: MessageError | undefined,
  { endedTurn, isLastMessage }: { endedTurn: boolean; isLastMessage: boolean },
): boolean {
  const classification =
    error && "classification" in error ? error.classification : undefined;
  return (
    (classification === "rate-limit" || classification === "transient") &&
    !isLastMessage &&
    !endedTurn
  );
}
