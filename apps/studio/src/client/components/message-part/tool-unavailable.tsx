import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolUnavailable({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-unavailable" };
}) {
  return null;
}
