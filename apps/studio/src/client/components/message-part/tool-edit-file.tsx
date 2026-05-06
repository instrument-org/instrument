import {
  type ProjectSubdomain,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";

type EditFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-edit_file" }
>;

export function ToolEditFile({
  part,
  subdomain,
}: {
  part: EditFilePart;
  subdomain: ProjectSubdomain;
}) {
  const filePath =
    part.state === "output-available"
      ? part.output.filePath
      : (part.input?.filePath ?? "");

  if (!filePath) {
    return null;
  }

  const isDone = part.state === "output-available";

  // When done show diff (trimming the file/===/ ---/+++ /@ header lines),
  // while streaming show the replacement string being written.
  let content: string;
  let language: string | undefined;

  if (isDone && part.output.diff) {
    content = part.output.diff.split("\n").slice(5).join("\n");
    language = "diff";
  } else {
    content = part.input?.newString ?? "";
  }

  return (
    <FileToolCard
      content={content}
      filePath={filePath}
      language={language}
      subdomain={subdomain}
    />
  );
}
