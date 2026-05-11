import {
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
import { ToolCallSessionProvider } from "./tool-call-session";
import { ToolCallSummary } from "./tool-call-summary";
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

export function isToolCallVisible({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
}) {
  return hasTerminalToolState(part) || isStreaming || isDeveloperMode;
}

export function ToolCall({
  isAgentRunning,
  isDeveloperMode,
  isStreaming,
  part,
  project,
  renderStream,
}: {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.ToolPart;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
}) {
  if (!isToolCallVisible({ isDeveloperMode, isStreaming, part })) {
    return null;
  }

  const isDeadDevMode =
    !hasTerminalToolState(part) && !isStreaming && isDeveloperMode;

  return (
    <ToolCallSessionProvider
      isAgentRunning={isAgentRunning}
      isStreaming={isStreaming}
    >
      <ToolCallSummary
        assetBaseUrl={project.urls.assetBase}
        isDeadDevMode={isDeadDevMode}
        part={part}
      >
        {isDeadDevMode ? (
          <DeadDevModeBody part={part} />
        ) : (
          <ToolCallBody
            part={part}
            project={project}
            renderStream={renderStream}
          />
        )}
      </ToolCallSummary>
    </ToolCallSessionProvider>
  );
}

function DeadDevModeBody({ part }: { part: SessionMessagePart.ToolPart }) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-blue-500/20 bg-card">
      <div className="border-b border-blue-500/20 bg-blue-500/5 px-4 py-2">
        <span className="text-xs font-medium text-blue-500/80">
          Stopped while <span className="font-mono">{part.state}</span>
        </span>
      </div>
      <div className="max-h-64 overflow-auto px-4 py-3 scrollbar-color scrollbar-thin">
        <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-foreground/70">
          {JSON.stringify(part.input, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function hasTerminalToolState(part: SessionMessagePart.ToolPart) {
  return part.state === "output-available" || part.state === "output-error";
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
