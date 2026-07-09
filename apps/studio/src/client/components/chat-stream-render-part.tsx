import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";

import { AssistantMessage } from "./assistant-message";
import { isDataPart, renderDataPart } from "./chat-stream-data-parts";
import { type RenderStream } from "./message-part/tool-agent";
import { ToolCall } from "./message-part/tool-call";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { ReasoningMessage } from "./reasoning-message";
import { isReasoningPartVisible } from "./reasoning-utils";
import { UnknownPart } from "./unknown-part";
import { UserMessage } from "./user-message";

export interface RenderPartContext {
  assetBaseUrl: string;
  currentToolId: string | undefined;
  hideUserMessages: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  lastMessageId: string | undefined;
  onRetry: (prompt: string) => void;
  renderStream: RenderStream;
  task: Task;
}

// Returns null for parts that don't render inline. Data-part visibility comes
// from `dataPartVisibility`, so this stays consistent with the utils.
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
            assetBaseUrl={ctx.assetBaseUrl}
            key={part.metadata.id}
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
      // session-context messages are partitioned out before this loop and shown
      // only via ContextMessages, so they never reach here.
      default: {
        return null;
      }
    }
  }

  if (part.type === "step-start") {
    return null;
  }

  if (isDataPart(part)) {
    return renderDataPart({ browserStatusContextAdded, ctx, part });
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
        assetBaseUrl={ctx.assetBaseUrl}
        isAgentRunning={ctx.isAgentRunning}
        isCurrentTool={part.metadata.id === ctx.currentToolId}
        isDeveloperMode={ctx.isDeveloperMode}
        isStreaming={streaming}
        key={part.metadata.id}
        onRetry={ctx.onRetry}
        part={part}
        renderStream={ctx.renderStream}
        task={ctx.task}
      />
    );
  }

  if (part.type === "reasoning") {
    if (!isReasoningPartVisible(part)) {
      return null;
    }
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
