import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolCopyToProject({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-copy_to_project" };
}) {
  return null;
}
