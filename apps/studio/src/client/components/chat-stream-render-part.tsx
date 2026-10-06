import {
  isToolPart,
  pathsNamedInMessage,
  type SessionMessage,
  type SessionMessagePart,
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
import { isPartBeingWritten } from "./transcript-layout";
import { UnknownPart } from "./unknown-part";
import { UserMessage } from "./user-message";

export interface RenderPartContext {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  lastMessageId: string | undefined;
  onRetry: (prompt: string) => void;
  /**
   * The conversation the user talks to shows its words and its questions,
   * and nothing of its machinery: no reasoning, no command rows, no cards
   * for the tasks it started, no notes from the harness. Developer mode
   * brings all of it back as rows between the bubbles, so what it ran and
   * why can be seen.
   */
  presentation?: "chat";
  task: Task;
}

// Returns null for parts that don't render inline. Data-part visibility comes
// from `dataPartVisibility`, so this stays consistent with the utils.
export function renderChatPart({
  browserStatusContextAdded,
  ctx,
  isStandIn = false,
  message,
  part,
  partIndex,
}: {
  browserStatusContextAdded: boolean;
  ctx: RenderPartContext;
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
            // The conversation reads as messages: each reply in a bubble at
            // the left, facing the user's at the right.
            bubble={ctx.presentation === "chat"}
            key={part.metadata.id}
            part={part}
            taskId={ctx.task.id}
          />
        );
      }
      case "user": {
        return (
          <UserMessage
            compact={ctx.presentation === "chat"}
            key={part.metadata.id}
            part={part}
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
    // What the conversation asks the user (a choice, a sign-in, a folder)
    // and nothing else: every other call is its own business, a task it
    // started included, since the tasks at work stand over the composer
    // rather than in the transcript. Developer mode shows every call.
    if (
      ctx.presentation === "chat" &&
      !ctx.isDeveloperMode &&
      part.type !== "tool-choose" &&
      part.type !== "tool-connect_app" &&
      part.type !== "tool-request_folder"
    ) {
      return null;
    }
    // A connect the tool refused never put a card up: what it said is the
    // agent's to fix before asking again, not the user's to read.
    if (
      ctx.presentation === "chat" &&
      !ctx.isDeveloperMode &&
      part.type === "tool-connect_app" &&
      part.state === "output-available" &&
      part.output.state === "failure"
    ) {
      return null;
    }
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
    if (ctx.presentation === "chat" && !ctx.isDeveloperMode) {
      return null;
    }
    // Whether the run is still writing into this block. Anything after it means
    // the model has moved on, whatever the part's own state says: a provider can
    // hold a reasoning block's end event until the step finishes, and a row that
    // counts up next to a running tool call reads as two things happening at
    // once. The same call decides whether the layout has a row here at all.
    const isLive = isPartBeingWritten({
      isAgentRunning: ctx.isAgentRunning,
      lastMessageId: ctx.lastMessageId,
      message,
      partIndex,
    });
    if (!isReasoningPartVisible({ isLive, part })) {
      return null;
    }
    return (
      <ReasoningMessage
        createdAt={part.metadata.createdAt}
        endedAt={part.metadata.endedAt}
        isLoading={isLive && part.state === "streaming"}
        isStandIn={isStandIn}
        key={part.metadata.id}
        rowId={part.metadata.id}
        text={part.text}
      />
    );
  }

  if (part.type === "source-document" || part.type === "source-url") {
    return null;
  }

  if (part.type === "file") {
    console.warn("File part not supported yet", part);
    return null;
  }

  const _exhaustiveCheck: never = part;
  return <UnknownPart key={partIndex} part={_exhaustiveCheck} />;
}
