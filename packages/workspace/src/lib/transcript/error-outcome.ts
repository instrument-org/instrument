import { type SessionMessage } from "../../schemas/session/message";
import { type TranscriptMessage } from "./transcript-message";

/**
 * What a reply's error comes to in the transcript, the one place that decides
 * it. `draws` is what a customer sees, the same for everyone, and `cause` is
 * what a developer's margin note calls it, whichever way that went.
 */
export interface ErrorOutcome {
  cause: string;
  /**
   * - `card`: its row, saying what happened.
   * - `online-retry`: a row that draws only the notice of a retry waiting on the
   *   computer coming back, and nothing once there isn't one.
   * - `nothing`: a row that draws nothing, keeping the turn's shape.
   * - `none`: no row.
   */
  draws: "card" | "none" | "nothing" | "online-retry";
}

type StoredError = NonNullable<SessionMessage.Assistant["metadata"]["error"]>;

const ABORT_CAUSES: Record<
  NonNullable<Extract<StoredError, { kind: "aborted" }>["reason"]>,
  string
> = {
  chat: "Stopped by the chat",
  manual: "Stopped",
  quit: "Stopped when the app quit",
  superseded: "Replaced by a newer message",
  timeout: "Timed out",
  unknown: "Stopped",
};

const classificationOf = (error: StoredError) =>
  "classification" in error ? error.classification : undefined;

const spelled = (name: string) => name.replaceAll("-", " ");

/**
 * Whether our own platform turned the request away for too many at once. The
 * reply box waits that out, so one the turn went on past has nothing to say.
 */
function isConcurrencyRefusal(
  metadata: SessionMessage.Assistant["metadata"],
): boolean {
  const { error } = metadata;
  if (error?.kind !== "api-call" || !error.responseBody) {
    return false;
  }
  try {
    const body: unknown = JSON.parse(error.responseBody);
    return (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      body.error.code === "concurrency-limit"
    );
  } catch {
    return false;
  }
}

/**
 * What an assistant message's error comes to, where `next` is the message after
 * it in its turn. Undefined for a message with no error.
 *
 * A stop has no row: the person asked for it, or the app or a newer message did.
 * A timeout is the exception once the turn ended on it, since nothing else says
 * why the reply never came. A failure the turn went on past (a throttle, a
 * provider's passing problem, or media the retry left out) has no row either,
 * since the retry says it whole, and a run of one refusal reads as its latest.
 */
export function errorOutcomeOf(
  message: TranscriptMessage,
  {
    isLive,
    lastMessageId,
    next,
  }: {
    isLive: boolean;
    lastMessageId: string | undefined;
    next: TranscriptMessage | undefined;
  },
): ErrorOutcome | undefined {
  if (message.role !== "assistant" || !message.metadata.error) {
    return undefined;
  }
  const { metadata } = message;
  const error = message.metadata.error as StoredError;
  const classification = classificationOf(error);
  const isLastMessage = message.id === lastMessageId;
  const endedTurn = next?.role !== "assistant";
  const name = spelled(classification ?? error.kind);

  if (error.kind === "aborted") {
    const cause = ABORT_CAUSES[error.reason ?? "unknown"];
    return {
      cause,
      draws:
        error.reason === "timeout" && endedTurn && !isLive ? "card" : "none",
    };
  }
  const isRetriedAway =
    (classification === "rate-limit" ||
      classification === "transient" ||
      (metadata.refusedMedia?.length ?? 0) > 0) &&
    !isLastMessage &&
    !endedTurn;
  if (isRetriedAway) {
    const isLatestAttempt =
      next?.id === lastMessageId &&
      next?.role === "assistant" &&
      !next.metadata.error &&
      next.parts.length === 0;
    return {
      cause: `Retried: ${name}`,
      draws: isLatestAttempt ? "online-retry" : "none",
    };
  }
  const nextError =
    next?.role === "assistant" ? next.metadata.error : undefined;
  if (
    nextError &&
    nextError.kind === error.kind &&
    classification !== undefined &&
    classification === classificationOf(nextError as StoredError)
  ) {
    return { cause: `Repeated: ${name}`, draws: "none" };
  }
  if (isConcurrencyRefusal(metadata)) {
    return {
      cause: "Waited for capacity",
      draws: isLastMessage ? "card" : "nothing",
    };
  }
  return { cause: `Error: ${name}`, draws: "card" };
}
