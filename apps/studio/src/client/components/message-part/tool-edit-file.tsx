import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";

import { FileToolCard } from "./file-tool-card";
import { stripPatchHeader } from "./tool-call-utils";
import { ToolCardEmpty } from "./tool-card";

type EditFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-edit_file" }
>;

export function ToolEditFile({ id, part }: { id: TaskId; part: EditFilePart }) {
  const filePath =
    part.state === "output-available"
      ? part.output.filePath
      : (part.input?.filePath ?? "");

  if (!filePath) {
    return (
      <ToolCardEmpty message="The file being edited has not arrived yet." />
    );
  }

  const isDone = part.state === "output-available";

  // When done show the diff, while streaming show the replacement string being
  // written.
  let content: string;
  let language: string | undefined;

  if (isDone && part.output.diff) {
    content = stripPatchHeader(part.output.diff);
    language = "diff";
  } else {
    content = part.input?.newString ?? "";
  }

  return (
    <FileToolCard
      content={content}
      filePath={filePath}
      id={id}
      language={language}
      modifiedAt={isDone ? part.output.modifiedAt : undefined}
    />
  );
}
