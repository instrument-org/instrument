import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolEditFile({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-edit_file" };
}) {
  return null;
}
