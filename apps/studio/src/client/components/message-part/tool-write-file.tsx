import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolWriteFile({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-write_file" };
}) {
  return null;
}
