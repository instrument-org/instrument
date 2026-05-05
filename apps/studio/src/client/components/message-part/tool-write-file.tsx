import {
  type ProjectSubdomain,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";

type WriteFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-write_file" }
>;

export function ToolWriteFile({
  isStreaming,
  part,
  subdomain,
}: {
  isStreaming: boolean;
  part: WriteFilePart;
  subdomain: ProjectSubdomain;
}) {
  const filePath =
    part.state === "output-available"
      ? part.output.filePath
      : (part.input?.filePath ?? "");

  const content = part.input?.content ?? "";

  if (!filePath) {
    return null;
  }

  return (
    <FileToolCard
      content={content}
      filePath={filePath}
      isStreaming={isStreaming}
      subdomain={subdomain}
    />
  );
}
