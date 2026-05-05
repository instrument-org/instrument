import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolChoose({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-choose" };
}) {
  return null;
}
