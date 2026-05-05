import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";

import { type RenderStream } from "../tool-part/task";
import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
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
  isAgentRunning,
  isStreaming,
  part,
  project,
  renderStream,
}: {
  isAgentRunning: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  return (
    <ToolCallHeader
      expandedContent={
        <ToolCallExpanded
          isStreaming={isStreaming}
          part={part}
          project={project}
          renderStream={renderStream}
        />
      }
      isAgentRunning={isAgentRunning}
      isStreaming={isStreaming}
      part={part}
    />
  );
}

function ToolCallExpanded({
  isStreaming,
  part,
  project,
  renderStream,
}: {
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  if (part.state === "output-error") {
    return <ToolCallError part={part} />;
  }

  switch (part.type) {
    case "tool-bash": {
      return (
        <ToolBash
          assetBaseUrl={project.urls.assetBase}
          isStreaming={isStreaming}
          part={part}
        />
      );
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
      return (
        <ToolTask
          isStreaming={isStreaming}
          part={part}
          project={project}
          renderStream={renderStream}
        />
      );
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
