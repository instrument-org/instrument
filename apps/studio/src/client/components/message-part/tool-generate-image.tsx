import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolGenerateImage({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-generate_image" };
}) {
  return null;
}
