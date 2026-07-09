import { type SessionMessagePart } from "@instrument-org/workspace/client";

// A completed reasoning part with no display text renders nothing (see
// `ReasoningMessage`'s null return), so layout/visibility callers must treat it
// as absent.
export function isReasoningPartVisible(part: SessionMessagePart.ReasoningPart) {
  return (
    part.state === "streaming" || reasoningDisplayText(part.text).trim() !== ""
  );
}

export function reasoningDisplayText(text: string) {
  return text.replaceAll("[REDACTED]", "");
}
