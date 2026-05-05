import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolTask({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-task" };
}) {
  return null;
}
