import { type SessionMessagePart } from "@instrument-org/workspace/client";

export function ToolGlob({
  part: _part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-glob" };
}) {
  return null;
}
