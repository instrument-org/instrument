import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
import { ToolCallHeader } from "./tool-call-header";
import { ToolCallSessionProvider } from "./tool-call-session";
import { ToolChoose } from "./tool-choose";
import { ToolCopyToProject } from "./tool-copy-to-project";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolGlob } from "./tool-glob";
import { ToolGrep } from "./tool-grep";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { type RenderStream, ToolTask } from "./tool-task";
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
    <ToolCallSessionProvider
      isAgentRunning={isAgentRunning}
      isStreaming={isStreaming}
    >
      <ToolCallHeader assetBaseUrl={project.urls.assetBase} part={part}>
        <ToolCallBody
          part={part}
          project={project}
          renderStream={renderStream}
        />
      </ToolCallHeader>
    </ToolCallSessionProvider>
  );
}

function ToolCallBody({
  part,
  project,
  renderStream,
}: {
  part: SessionMessagePart.ToolPart;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  if (part.state === "output-error") {
    return <ToolCallError part={part} />;
  }

  switch (part.type) {
    case "tool-bash": {
      return <ToolBash assetBaseUrl={project.urls.assetBase} part={part} />;
    }
    case "tool-choose": {
      return <ToolChoose part={part} />;
    }
    case "tool-copy_to_project": {
      return <ToolCopyToProject part={part} />;
    }
    case "tool-edit_file": {
      return <ToolEditFile part={part} subdomain={project.subdomain} />;
    }
    case "tool-generate_image": {
      return (
        <ToolGenerateImage
          assetBaseUrl={project.urls.assetBase}
          part={part}
          subdomain={project.subdomain}
        />
      );
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
      return <ToolReadFile part={part} subdomain={project.subdomain} />;
    }
    case "tool-task": {
      return (
        <ToolTask part={part} project={project} renderStream={renderStream} />
      );
    }
    case "tool-unavailable": {
      return <ToolUnavailable part={part} />;
    }
    case "tool-web_search": {
      return <ToolWebSearch part={part} />;
    }
    case "tool-write_file": {
      return <ToolWriteFile part={part} subdomain={project.subdomain} />;
    }
  }
}
