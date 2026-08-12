import { pathsNamedInMessage } from "@/client/lib/paths-named-in-message";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
  type Task,
} from "@instrument-org/workspace/client";

import { AssistantMessage } from "./assistant-message";
import { isDataPart, renderDataPart } from "./chat-stream-data-parts";
import { ToolCall } from "./message-part/tool-call";
import {
  isToolCallVisible,
  isToolPartRunning,
} from "./message-part/tool-call-utils";
import { ReasoningMessage } from "./reasoning-message";
import { isReasoningPartVisible } from "./reasoning-utils";
import { UnknownPart } from "./unknown-part";
import { UserMessage, type UserMessageEditSubmit } from "./user-message";

export interface RenderPartContext {
  assetBaseUrl: string;
  discardCountForMessage?: (messageId: StoreId.Message) => number;
  editingMessageId?: StoreId.Message;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isEditPending?: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  lastMessageId: string | undefined;
  modelURI?: AIGatewayModelURI.Type;
  onCancelEdit?: () => void;
  onModelChange?: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onStartEdit?: (message: SessionMessage.UserWithParts) => void;
  onSubmitEdit?: (
    message: SessionMessage.UserWithParts,
    value: UserMessageEditSubmit,
  ) => void;
  selectedSessionId?: StoreId.Session;
  task: Task;
}

// Returns null for parts that don't render inline. Data-part visibility comes
// from `dataPartVisibility`, so this stays consistent with the utils.
export function renderChatPart({
  browserStatusContextAdded,
  ctx,
  isGroupWorking,
  isStandIn = false,
  message,
  part,
  partIndex,
}: {
  browserStatusContextAdded: boolean;
  ctx: RenderPartContext;
  /** The group this part sits in is still taking rows; see `TranscriptGroup`. */
  isGroupWorking: boolean;
  /**
   * This is the copy a working group draws in its own slot rather than the row
   * where it really sits, so it is arriving into a place that is already on
   * screen and already occupied. `GroupStandIn` is what moves it in; a row that
   * also animates its own arrival animates twice.
   */
  isStandIn?: boolean;
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
            taskId={ctx.task.id}
          />
        );
      }
      case "user": {
        return (
          <UserMessage
            assetBaseUrl={ctx.assetBaseUrl}
            discardCount={ctx.discardCountForMessage?.(message.id) ?? 0}
            isEditing={ctx.editingMessageId === message.id}
            isEditPending={ctx.isEditPending}
            key={part.metadata.id}
            message={message}
            modelURI={ctx.modelURI}
            onCancelEdit={ctx.onCancelEdit}
            onModelChange={ctx.onModelChange}
            onStartEdit={
              ctx.onStartEdit ? () => ctx.onStartEdit?.(message) : undefined
            }
            onSubmitEdit={
              ctx.onSubmitEdit
                ? (value) => ctx.onSubmitEdit?.(message, value)
                : undefined
            }
            part={part}
            selectedSessionId={ctx.selectedSessionId}
            taskId={ctx.task.id}
          />
        );
      }
      // session-context messages are filtered out before this loop, so they
      // never reach here.
      default: {
        return null;
      }
    }
  }

  if (part.type === "step-start") {
    return null;
  }

  if (isDataPart(part)) {
    return renderDataPart({
      browserStatusContextAdded,
      ctx,
      part,
      // Only the retired file-changes grid needs this, and almost no message
      // carries one, so the message's text is not read unless one does.
      pathsAlreadyShown:
        part.type === "data-fileChanges"
          ? pathsNamedInMessage(message)
          : undefined,
    });
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

    // Indentation and the group box around a run of these are the chat
    // stream's, not this row's.
    return (
      <ToolCall
        assetBaseUrl={ctx.assetBaseUrl}
        isActivityRunning={isGroupWorking && ctx.isAgentRunning}
        isDeveloperMode={ctx.isDeveloperMode}
        // A part can carry a start with no end long after the run that wrote it
        // died, so the record alone never means "running now": the live session
        // has to agree, which is what `isToolStreaming` already establishes.
        isRunning={streaming && isToolPartRunning(part)}
        isStreaming={streaming}
        key={part.metadata.id}
        onRetry={ctx.onRetry}
        part={part}
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
        // Anything after it means the model has moved on, whatever the part's
        // own state says: a provider can hold a reasoning block's end event
        // until the step finishes, and a row that counts up next to a running
        // tool call reads as two things happening at once.
        isLoading={
          ctx.isAgentRunning &&
          ctx.lastMessageId === message.id &&
          partIndex === message.parts.length - 1 &&
          part.state === "streaming"
        }
        isStandIn={isStandIn}
        key={part.metadata.id}
        text={part.text}
      />
    );
  }

  if (part.type === "source-document" || part.type === "source-url") {
    return null;
  }

  // oxlint-disable-next-line typescript/no-unnecessary-condition -- defensive guard: the schema could emit a `file` part the type union treats as unreachable
  if (part.type === "file") {
    // eslint-disable-next-line no-console
    console.warn("File part not supported yet", part);
    return null;
  }

  const _exhaustiveCheck: never = part;
  return <UnknownPart key={partIndex} part={_exhaustiveCheck} />;
}
