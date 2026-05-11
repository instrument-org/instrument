import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function hasTerminalToolState(part: SessionMessagePart.ToolPart) {
  return part.state === "output-available" || part.state === "output-error";
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
  return hasTerminalToolState(part) || isStreaming || isDeveloperMode;
}
