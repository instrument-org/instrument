import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolReadFile({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-read_file" };
}) {
  return null;
}
