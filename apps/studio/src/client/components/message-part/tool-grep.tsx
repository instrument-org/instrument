import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolGrep({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-grep" };
}) {
  return null;
}
