import { type SessionMessagePart } from "@instrument-org/workspace/client";

// A reasoning part with no display text draws a row only while the run that
// opened it is still writing into it (see `ReasoningMessage`'s null return), so
// layout/visibility callers must otherwise treat it as absent. Liveness is the
// caller's to supply and is read against the live session: the part's own state
// says streaming for the rest of its life, the run that wrote it included.
export function isReasoningPartVisible({
  isLive,
  part,
}: {
  isLive: boolean;
  part: SessionMessagePart.ReasoningPart;
}) {
  return (
    reasoningDisplayText(part.text).trim() !== "" ||
    (isLive && part.state === "streaming")
  );
}

export function reasoningDisplayText(text: string) {
  return text.replaceAll("[REDACTED]", "");
}
