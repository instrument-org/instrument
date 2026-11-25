import {
  isInterruptedByClosing,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

/**
 * Whether a call ended because the app closed while it ran, rather than
 * failing: the quit or the next launch's sweep settled it.
 */
export function isCutOff(part: SessionMessagePart.ToolPart): boolean {
  return (
    part.state === "output-error" && isInterruptedByClosing(part.errorText)
  );
}
