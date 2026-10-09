import { type SessionMessagePart } from "@instrument-org/workspace/client";

// A reasoning part with no display text draws a row only while it is live
// (see `ReasoningMessage`'s null return), so layout/visibility callers must
// otherwise treat it as absent.
export function isReasoningPartVisible({
  isLive,
  part,
}: {
  isLive: boolean;
  part: SessionMessagePart.ReasoningPart;
}) {
  return hasReasoningText(part) || isReasoningPartLive({ isLive, part });
}

// Whether the agent is still thinking in this block. `isLive` is the caller's,
// read against the live session and the part's position: the part's own state
// says streaming for the rest of its life, the run that wrote it included. A
// blank block stays live once closed for as long as nothing follows it, since a
// provider can close one before it has begun the call after it, and dropping
// the row then would leave nothing in its place until the call lands.
export function isReasoningPartLive({
  isLive,
  part,
}: {
  isLive: boolean;
  part: SessionMessagePart.ReasoningPart;
}) {
  return isLive && (part.state === "streaming" || !hasReasoningText(part));
}

export function reasoningDisplayText(text: string) {
  return text.replaceAll("[REDACTED]", "");
}

function hasReasoningText(part: SessionMessagePart.ReasoningPart) {
  return reasoningDisplayText(part.text).trim() !== "";
}
