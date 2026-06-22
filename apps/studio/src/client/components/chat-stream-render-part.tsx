import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";

import { AssistantMessage } from "./assistant-message";
import { BrowserStatusDebugCard } from "./browser-status-debug-card";
import { ExternalFileChangesDebugCard } from "./external-file-changes-debug-card";
import { FileChangesCard } from "./file-changes-card";
import { ToolCall } from "./message-part/tool-call";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { type RenderStream } from "./message-part/tool-task";
import { ReasoningMessage } from "./reasoning-message";
import { ContextMessage } from "./session-context-message";
import { UnknownPart } from "./unknown-part";
import { UserMessage } from "./user-message";

export interface RenderPartContext {
  hideUserMessages: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  lastMessageId: string | undefined;
  onRetry: (prompt: string) => void;
  project: Task;
  renderStream: RenderStream;
}

// Returns null for parts that don't render inline (kept in sync with
// `isRenderableInlinePart`).
export function renderChatPart({
  browserStatusContextAdded,
  ctx,
  message,
  part,
  partIndex,
}: {
  browserStatusContextAdded: boolean;
  ctx: RenderPartContext;
  message: SessionMessage.WithParts;
  part: SessionMessagePart.Type;
  partIndex: number;
}): React.ReactNode {
  if (part.type === "text") {
    if (part.state === "done" && part.text.trim() === "") {
      return null;
    }

    switch (message.role) {
      case "assistant": {
        return (
          <AssistantMessage
            assetBaseUrl={ctx.project.assetBase}
            key={part.metadata.id}
            part={part}
          />
        );
      }
      case "session-context": {
        return (
          <ContextMessage
            key={part.metadata.id}
            message={message}
            part={part}
          />
        );
      }
      case "user": {
        if (ctx.hideUserMessages) {
          return null;
        }
        return <UserMessage key={part.metadata.id} part={part} />;
      }
      default: {
        return null;
      }
    }
  }

  if (part.type === "step-start") {
    return null;
  }

  if (part.type === "data-fileChanges") {
    return (
      <FileChangesCard
        assetBaseUrl={ctx.project.assetBase}
        className="mt-2"
        files={part.data.files}
        key={part.metadata.id}
        taskId={ctx.project.id}
      />
    );
  }

  if (part.type === "data-attachments") {
    return null;
  }

  if (part.type === "data-browserStatus") {
    if (!ctx.isDeveloperMode || !browserStatusContextAdded) {
      return null;
    }
    return (
      <BrowserStatusDebugCard
        className="mt-2"
        data={part.data}
        key={part.metadata.id}
      />
    );
  }

  if (part.type === "data-externalFileChanges") {
    if (!ctx.isDeveloperMode) {
      return null;
    }
    return (
      <ExternalFileChangesDebugCard
        className="mt-2"
        files={part.data.files}
        key={part.metadata.id}
      />
    );
  }

  if (isToolPart(part)) {
    const streaming = ctx.isToolStreaming(part, message);
    if (
      !isToolCallVisible({
        isDeveloperMode: ctx.isDeveloperMode,
        isStreaming: streaming,
        part,
      })
    ) {
      return null;
    }

    // The boundary wrapper div with mt-2/mb-2 around tool-call runs is added
    // by the chat stream caller, not here.
    return (
      <ToolCall
        isAgentRunning={ctx.isAgentRunning}
        isDeveloperMode={ctx.isDeveloperMode}
        isStreaming={streaming}
        key={part.metadata.id}
        onRetry={ctx.onRetry}
        part={part}
        project={ctx.project}
        renderStream={ctx.renderStream}
      />
    );
  }

  if (part.type === "reasoning") {
    return (
      <ReasoningMessage
        createdAt={part.metadata.createdAt}
        endedAt={part.metadata.endedAt}
        isLoading={
          ctx.isAgentRunning &&
          ctx.lastMessageId === message.id &&
          part.state === "streaming"
        }
        key={part.metadata.id}
        text={part.text}
      />
    );
  }

  if (part.type === "source-document" || part.type === "source-url") {
    return null;
  }

  // Still checking condition just in case schema and type mismatch
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (part.type === "file") {
    // eslint-disable-next-line no-console
    console.warn("File part not supported yet", part);
    return null;
  }

  const _exhaustiveCheck: never = part;
  return <UnknownPart key={partIndex} part={_exhaustiveCheck} />;
}
