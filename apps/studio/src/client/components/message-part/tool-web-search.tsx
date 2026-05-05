import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolWebSearch({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-web_search" };
}) {
  return null;
}
