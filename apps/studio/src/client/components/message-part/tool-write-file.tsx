import { type SessionMessagePart, type TaskId } from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";

type WriteFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-write_file" }
>;

export function ToolWriteFile({
  part,
  subdomain,
}: {
  part: WriteFilePart;
  subdomain: TaskId;
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
      modifiedAt={modifiedAt}
      subdomain={subdomain}
    />
  );
}
