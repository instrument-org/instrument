import { useRunningBackgroundProcess } from "@/client/hooks/use-task-background-processes";
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
  isAwaitingUser,
  isToolCallVisible,
} from "./tool-call-utils";
import { ToolChoose } from "./tool-choose";
import { ToolConnectApp } from "./tool-connect-app";
import { ToolEditFile } from "./tool-edit-file";
import { ToolGenerateImage } from "./tool-generate-image";
import { ToolLoadSkill } from "./tool-load-skill";
import { ToolReadFile } from "./tool-read-file";
import { ToolRequestFolder } from "./tool-request-folder";
import { ToolUnavailable } from "./tool-unavailable";
import { ToolWebFetch } from "./tool-web-fetch";
import { ToolWebSearch } from "./tool-web-search";
import { ToolWriteFile } from "./tool-write-file";

export function ToolCall({
  isDeveloperMode,
  isRunning,
  isStreaming,
  onRetry,
  part,
  task,
}: {
  isDeveloperMode: boolean;
  isRunning: boolean;
  isStreaming: boolean;
  onRetry: (prompt: string) => void;
  part: SessionMessagePart.ToolPart;
  task: Task;
}) {
  // Read for every call rather than only for bash, because a hook cannot sit
  // behind the visibility check below. One query key backs the whole transcript,
  // so the cost is a lookup per row and a single request per task.
  const backgroundProcess = useRunningBackgroundProcess({
    processId:
      part.type === "tool-bash" && part.state === "output-available"
        ? part.output.processId
        : undefined,
    sessionId: part.metadata.sessionId,
    taskId: task.id,
  });

  if (!isToolCallVisible({ isDeveloperMode, isRunning, part })) {
    return null;
  }

  const isDeadDevMode =
    !hasTerminalToolState(part) &&
    !isStreaming &&
    !isAwaitingUser(part) &&
    isDeveloperMode;

  return (
    <ToolCallSessionProvider
      backgroundProcess={backgroundProcess}
      isRunning={isRunning}
      isStreaming={isStreaming}
    >
      <ToolCallSummary
        isDeadDevMode={isDeadDevMode}
        part={part}
        taskId={task.id}
      >
        {isDeadDevMode ? (
          <DeadDevModeBody part={part} />
        ) : (
          <ToolCallBody onRetry={onRetry} part={part} task={task} />
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

/**
 * What a call says, without the row that opens it. The chat draws the cards
 * that ask the user something this way, since the card is the whole of what
 * there is to read.
 */
export function ToolCallBody({
  onRetry,
  part,
  task,
}: {
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
      return <ToolChoose part={part} taskId={task.id} />;
    }
    case "tool-connect_app": {
      return <ToolConnectApp part={part} />;
    }
    case "tool-edit_file": {
      return <ToolEditFile part={part} />;
    }
    case "tool-generate_image": {
      return <ToolGenerateImage id={task.id} onRetry={onRetry} part={part} />;
    }
    case "tool-load_skill": {
      return <ToolLoadSkill part={part} />;
    }
    case "tool-read_file": {
      return <ToolReadFile part={part} />;
    }
    case "tool-request_folder": {
      return <ToolRequestFolder part={part} taskId={task.id} />;
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
      return <ToolWriteFile part={part} />;
    }
  }
}
