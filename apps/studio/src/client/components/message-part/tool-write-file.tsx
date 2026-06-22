import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";

type WriteFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-write_file" }
>;

export function ToolWriteFile({
  id,
  part,
}: {
  id: TaskId;
  part: WriteFilePart;
}) {
  const filePath =
    part.state === "output-available"
      ? part.output.filePath
      : (part.input?.filePath ?? "");

  const content = part.input?.content ?? "";
  const modifiedAt =
    part.state === "output-available" ? part.output.modifiedAt : undefined;

  if (!filePath) {
    return null;
  }

  return (
    <FileToolCard
      content={content}
      filePath={filePath}
      id={id}
      modifiedAt={modifiedAt}
    />
  );
}
