import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";
import { ToolCardEmpty } from "./tool-card";

type WriteFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-write_file" }
>;

export function ToolWriteFile({ part }: { part: WriteFilePart }) {
  const filePath =
    part.state === "output-available"
      ? part.output.filePath
      : (part.input?.filePath ?? "");

  const content = part.input?.content ?? "";
  const modifiedAt =
    part.state === "output-available" ? part.output.modifiedAt : undefined;

  if (!filePath) {
    return (
      <ToolCardEmpty message="The file being written has not arrived yet." />
    );
  }

  return (
    <FileToolCard
      content={content}
      filePath={filePath}
      modifiedAt={modifiedAt}
    />
  );
}
