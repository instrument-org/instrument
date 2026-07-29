import {
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";

import { ToolBash } from "./tool-bash";
import { ToolCallError } from "./tool-call-error";
import { ToolCallSessionProvider } from "./tool-call-session";
import { ToolCallSummary } from "./tool-call-summary";
import {
  hasTerminalToolState,
  isPendingInteractiveToolCall,
  isToolCallVisible,
} from "./tool-call-utils";
import { ToolChoose } from "./tool-choose";
import {
  ToolConnectorMcp,
  ToolConnectorRequest,
  ToolConnectorTest,
} from "./tool-connector";
import { ToolConnectorCredentialPrompt } from "./tool-connector-credential-prompt";
import { ToolConnectorOAuthPrompt } from "./tool-connector-oauth-prompt";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { ToolUnavailable } from "./tool-unavailable";
import { ToolWebFetch } from "./tool-web-fetch";
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

  // A parked interactive tool call (credential prompt, choose) is non-terminal
  // and not streaming, but it is genuinely awaiting the user -- not a stopped
  // run -- so it must render its real body, not the dead-dev-mode placeholder.
  const isDeadDevMode =
    !hasTerminalToolState(part) &&
    !isStreaming &&
    isDeveloperMode &&
    !isPendingInteractiveToolCall(part);

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
      return <ToolBash part={part} />;
    }
    case "tool-choose": {
      return <ToolChoose part={part} />;
    }
    case "tool-connector_credential_prompt": {
      return <ToolConnectorCredentialPrompt part={part} taskId={task.id} />;
    }
    case "tool-connector_mcp": {
      return <ToolConnectorMcp part={part} />;
    }
    case "tool-connector_oauth_prompt": {
      return <ToolConnectorOAuthPrompt part={part} taskId={task.id} />;
    }
    case "tool-connector_request": {
      return <ToolConnectorRequest part={part} />;
    }
    case "tool-connector_test": {
      return <ToolConnectorTest part={part} />;
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
    case "tool-load_skill": {
      return <ToolLoadSkill part={part} />;
    }
    case "tool-read_file": {
      return <ToolReadFile id={task.id} part={part} />;
    }
    case "tool-unavailable": {
      return <ToolUnavailable part={part} />;
    }
    case "tool-web_fetch": {
      return <ToolWebFetch part={part} />;
    }
    case "tool-web_search": {
      return <ToolWebSearch onRetry={onRetry} part={part} />;
    }
    case "tool-write_file": {
      return <ToolWriteFile id={task.id} part={part} />;
    }
  }
}
