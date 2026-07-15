import {
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
import { ToolCallSessionProvider } from "./tool-call-session";
import { ToolCallSummary } from "./tool-call-summary";
import { hasTerminalToolState, isToolCallVisible } from "./tool-call-utils";
import { ToolChoose } from "./tool-choose";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolGlob } from "./tool-glob";
import { ToolGrep } from "./tool-grep";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { ToolUnavailable } from "./tool-unavailable";
import { ToolWebSearch } from "./tool-web-search";
import { ToolWriteFile } from "./tool-write-file";

export function ToolCall({
  assetBaseUrl,
  isAgentRunning,
  isCurrentTool,
  isDeveloperMode,
  isStreaming,
  onRetry,
  part,
  task,
}: {
  assetBaseUrl: string;
  isAgentRunning: boolean;
  isCurrentTool: boolean;
  isDeveloperMode: boolean;
  isStreaming: boolean;
  onRetry: (prompt: string) => void;
  part: SessionMessagePart.ToolPart;
  task: Task;
}) {
  if (!isToolCallVisible({ isDeveloperMode, isStreaming, part })) {
    return null;
  }

  const isDeadDevMode =
    !hasTerminalToolState(part) && !isStreaming && isDeveloperMode;

  return (
    <ToolCallSessionProvider
      isAgentRunning={isAgentRunning}
      isCurrentTool={isCurrentTool}
      isStreaming={isStreaming}
    >
      <ToolCallSummary
        assetBaseUrl={assetBaseUrl}
        isDeadDevMode={isDeadDevMode}
        part={part}
      >
        {isDeadDevMode ? (
          <DeadDevModeBody part={part} />
        ) : (
          <ToolCallBody
            assetBaseUrl={assetBaseUrl}
            onRetry={onRetry}
            part={part}
            task={task}
          />
        )}
      </ToolCallSummary>
    </ToolCallSessionProvider>
  );
}

function DeadDevModeBody({ part }: { part: SessionMessagePart.ToolPart }) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-dev-500/20 bg-card">
      <div className="border-b border-dev-500/20 bg-dev-500/5 px-4 py-2">
        <span className="text-xs font-medium text-dev-500/80">
          Stopped while <span className="font-mono">{part.state}</span>
        </span>
      </div>
      <div className="max-h-64 scrollbar-thin scrollbar-color overflow-auto px-4 py-3">
        <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap text-foreground/70">
          {JSON.stringify(part.input, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function ToolCallBody({
  assetBaseUrl,
  onRetry,
  part,
  task,
}: {
  assetBaseUrl: string;
  onRetry: (prompt: string) => void;
  part: SessionMessagePart.ToolPart;
  task: Task;
}) {
  if (part.state === "output-error") {
    return <ToolCallError part={part} />;
  }

  switch (part.type) {
    case "tool-bash": {
      return <ToolBash assetBaseUrl={assetBaseUrl} part={part} />;
    }
    case "tool-choose": {
      return <ToolChoose part={part} />;
    }
    case "tool-edit_file": {
      return <ToolEditFile id={task.id} part={part} />;
    }
    case "tool-generate_image": {
      return (
        <ToolGenerateImage
          assetBaseUrl={assetBaseUrl}
          id={task.id}
          onRetry={onRetry}
          part={part}
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
      return <ToolReadFile id={task.id} part={part} />;
    }
    case "tool-unavailable": {
      return <ToolUnavailable part={part} />;
    }
    case "tool-web_search": {
      return <ToolWebSearch onRetry={onRetry} part={part} />;
    }
    case "tool-write_file": {
      return <ToolWriteFile id={task.id} part={part} />;
    }
  }
}
