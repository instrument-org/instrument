import {
  getToolNameByType,
  isInteractiveTool,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

export function hasTerminalToolState(part: SessionMessagePart.ToolPart) {
  return part.state === "output-available" || part.state === "output-error";
}

// An interactive tool call (credential prompt, choose) that is waiting for the
// user sits in `input-available` while the agent is paused, so it is neither
// terminal nor "streaming". It must stay visible regardless, or the user has
// no way to answer it.
export function isPendingInteractiveToolCall(
  part: SessionMessagePart.ToolPart,
) {
  return (
    part.state === "input-available" &&
    isInteractiveTool(getToolNameByType(part.type))
  );
}

export function isToolCallVisible({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  return (
    hasTerminalToolState(part) ||
    isPendingInteractiveToolCall(part) ||
    isStreaming ||
    isDeveloperMode
  );
}
