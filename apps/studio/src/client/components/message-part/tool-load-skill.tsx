import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolLoadSkill({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-load_skill" };
}) {
  return null;
}
