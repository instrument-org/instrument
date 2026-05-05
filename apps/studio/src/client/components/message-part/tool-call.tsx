import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallHeader } from "./tool-call-header";
import { ToolChoose } from "./tool-choose";
import { ToolCopyToProject } from "./tool-copy-to-project";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolGlob } from "./tool-glob";
import { ToolGrep } from "./tool-grep";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { ToolTask } from "./tool-task";
import { ToolUnavailable } from "./tool-unavailable";
import { ToolWebSearch } from "./tool-web-search";
import { ToolWriteFile } from "./tool-write-file";

export function ToolCall({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  return (
    <ToolCallHeader
      expandedContent={
        <ToolCallExpanded isStreaming={isStreaming} part={part} />
      }
      isStreaming={isStreaming}
      part={part}
    />
  );
}

function ToolCallExpanded({
  isStreaming,
  part,
}: {
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  switch (part.type) {
    case "tool-bash": {
      return <ToolBash isStreaming={isStreaming} part={part} />;
    }
    case "tool-choose": {
      return <ToolChoose part={part} />;
    }
    case "tool-copy_to_project": {
      return <ToolCopyToProject part={part} />;
    }
    case "tool-edit_file": {
      return <ToolEditFile part={part} />;
    }
    case "tool-generate_image": {
      return <ToolGenerateImage part={part} />;
    }
    case "tool-glob": {
      return <ToolGlob part={part} />;
    }
    case "tool-grep": {
      return <ToolGrep part={part} />;
    }
    case "tool-load_skill": {
      return <ToolLoadSkill part={part} />;
    }
    case "tool-read_file": {
      return <ToolReadFile part={part} />;
    }
    case "tool-task": {
      return <ToolTask part={part} />;
    }
    case "tool-unavailable": {
      return <ToolUnavailable part={part} />;
    }
    case "tool-web_search": {
      return <ToolWebSearch part={part} />;
    }
    case "tool-write_file": {
      return <ToolWriteFile part={part} />;
    }
  }
}
