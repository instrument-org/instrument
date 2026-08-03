import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  browserStatusModelNote,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getAssetBaseUrl } from "../lib/asset-base-url";
import { cn } from "../lib/utils";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";
import {
  buildRunBoundaryMap,
  isActiveToolPart,
  isVisibleAssistantPart,
  PLANNING_BOUNDARY_ID,
} from "./chat-stream-utils";
import { ContextMessages } from "./context-messages";
import { MessageError } from "./message-error";
import { ProjectContextNote } from "./project-context-note";
import { ReasoningMessage } from "./reasoning-message";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { MessageScrollerItem } from "./ui/message-scroller";
import { Wordmark } from "./wordmark";

// After a streaming text part stops growing for this long, treat it as stalled
// so the planning loader can reappear beneath the otherwise-finished prose.
const STREAM_STALL_MS = 700;

interface ChatStreamProps {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onStartNewTask: () => void;
  // Wrap each turn in a MessageScrollerItem so the transcript scroller can
  // anchor turns. Only the top-level transcript sets this; nested tool-agent
  // streams render flat.
  renderAsItems?: boolean;
  task: Task;
}

export function ChatStream({
  isAgentRunning,
  isDeveloperMode,
  messages,
  onContinue,
  onModelChange,
  onRetry,
  onStartNewTask,
  renderAsItems = false,
  task,
}: ChatStreamProps) {
  const assetBaseUrl = getAssetBaseUrl(task.id);

  const { contextMessages, regularMessages } = useMemo(() => {
    const result = {
      contextMessages: [] as SessionMessage.ContextWithParts[],
      regularMessages: [] as SessionMessage.WithParts[],
    };
    for (const message of messages) {
      if (message.role === "session-context") {
        result.contextMessages.push(message);
      } else {
        result.regularMessages.push(message);
      }
    }
    return result;
  }, [messages]);

  const lastMessageId = regularMessages.at(-1)?.id;
  const lastRegularMessage = regularMessages.at(-1);
  const lastAssistantMessage =
    lastRegularMessage?.role === "assistant" ? lastRegularMessage : undefined;

  const isToolStreaming = useCallback(
    (part: SessionMessagePart.ToolPart, message: SessionMessage.WithParts) =>
      isAgentRunning && lastMessageId === message.id && isActiveToolPart(part),
    [isAgentRunning, lastMessageId],
  );

  // A still-streaming text part at the tail of the live assistant message that
  // already has visible content. It is the one active state with no inline
  // loading affordance of its own (AssistantMessage renders plain markdown), so
  // it, and only it, suppresses the planning loader while it grows.
  const streamingTailText = useMemo(() => {
    if (!isAgentRunning || !lastAssistantMessage) {
      return;
    }
    const lastPart = lastAssistantMessage.parts.at(-1);
    if (
      lastPart?.type === "text" &&
      lastPart.state !== "done" &&
      lastPart.text.trim() !== ""
    ) {
      return lastPart.text;
    }
    return;
  }, [isAgentRunning, lastAssistantMessage]);

  const streamingTailTextStalled = useStreamStalled(streamingTailText);

  const hasActiveLoadingState = useMemo(() => {
    if (!isAgentRunning || !lastAssistantMessage) {
      return false;
    }

    const lastPart = lastAssistantMessage.parts.at(-1);
    if (!lastPart) {
      return false;
    }
    if (lastPart.type === "text") {
      // Empty streaming text renders nothing and stalled streaming text has
      // stopped producing output; neither should mask the planning loader.
      return streamingTailText !== undefined && !streamingTailTextStalled;
    }
    if (isToolPart(lastPart)) {
      return isActiveToolPart(lastPart);
    }
    if (lastPart.type === "reasoning" && lastPart.state === "streaming") {
      return true;
    }
    return false;
  }, [
    isAgentRunning,
    lastAssistantMessage,
    streamingTailText,
    streamingTailTextStalled,
  ]);

  const isPlanningVisible = isAgentRunning && !hasActiveLoadingState;

  const lastAssistantMessageHasVisibleParts = useMemo(() => {
    if (!lastAssistantMessage) {
      return false;
    }
    return lastAssistantMessage.parts.some((part) =>
      isVisibleAssistantPart({
        isDeveloperMode,
        isStreaming: isToolPart(part)
          ? isToolStreaming(part, lastAssistantMessage)
          : false,
        part,
      }),
    );
  }, [isDeveloperMode, isToolStreaming, lastAssistantMessage]);

  // Precomputed so run edges can span message boundaries.
  const runBoundaryMap = useMemo(
    () =>
      buildRunBoundaryMap({
        hasTrailingPlanning: isPlanningVisible,
        isDeveloperMode,
        isToolStreaming,
        regularMessages,
      }),
    [isDeveloperMode, isPlanningVisible, isToolStreaming, regularMessages],
  );

  const renderCtx: RenderPartContext = useMemo(
    () => ({
      assetBaseUrl,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      task,
    }),
    [
      assetBaseUrl,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      task,
    ],
  );

  const chatElements = useMemo(() => {
    const planningBoundary = runBoundaryMap.get(PLANNING_BOUNDARY_ID);
    const elements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let previousBrowserStatusNote: string | undefined;
    let visibleAssistantContentCount = 0;

    for (const [messageIndex, message] of regularMessages.entries()) {
      const messageElements: React.ReactNode[] = [];

      const prevMessage = regularMessages[messageIndex - 1];
      const nextMessage = regularMessages[messageIndex + 1];
      const isFirstInConsecutiveAssistantGroup =
        message.role === "assistant" && prevMessage?.role !== "assistant";
      const isLastInConsecutiveAssistantGroup =
        message.role === "assistant" && nextMessage?.role !== "assistant";
      const isLastMessage = messageIndex === regularMessages.length - 1;

      // Attachments are hoisted into per-message chrome below.
      const fileAttachments: SessionMessagePart.Type[] = [];
      let projectContextPart: SessionMessagePart.DataPart | undefined;
      const seenSourceIds = new Set<string>();

      for (const [partIndex, part] of message.parts.entries()) {
        let browserStatusContextAdded = false;
        if (part.type === "data-browserStatus") {
          const note = browserStatusModelNote(part.data);
          browserStatusContextAdded = note !== previousBrowserStatusNote;
          previousBrowserStatusNote = note;
        }

        if (part.type === "source-document" || part.type === "source-url") {
          if (seenSourceIds.has(part.sourceId)) {
            continue;
          }
          seenSourceIds.add(part.sourceId);
          continue;
        }

        if (message.role === "user" && part.type === "data-attachments") {
          fileAttachments.push(part);
          continue;
        }

        if (message.role === "user" && part.type === "data-projectContext") {
          projectContextPart = part;
          continue;
        }

        const node = renderChatPart({
          browserStatusContextAdded,
          ctx: renderCtx,
          message,
          part,
          partIndex,
        });
        if (!node) {
          continue;
        }

        const boundary = runBoundaryMap.get(part.metadata.id);
        if (boundary?.isRunRow) {
          messageElements.push(
            <div
              className={cn(
                !boundary.prevIsRunRow && "mt-2",
                !boundary.nextIsRunRow && "mb-2",
              )}
              key={`run-row-${part.metadata.id}`}
            >
              {node}
            </div>,
          );
        } else {
          messageElements.push(node);
        }

        if (message.role === "assistant") {
          visibleAssistantContentCount++;
        }
      }

      // Planning is the tail of the last turn rather than a row of its own, so
      // it lands where the call that replaces it will. The two swap places
      // constantly while a run steps, and any difference in offset between them
      // reads as the transcript jumping, so it takes its margins from the same
      // run adjacency a tool call wrapper does.
      if (isLastMessage && planningBoundary) {
        messageElements.push(
          <div
            className={cn(!planningBoundary.prevIsRunRow && "mt-2", "mb-2")}
            key="planning"
          >
            <ReasoningMessage
              isLoading
              noDelay={!lastAssistantMessageHasVisibleParts}
              text=""
            />
          </div>,
        );
      }

      // --- Per-message chrome ---

      const isLogoVisible =
        isFirstInConsecutiveAssistantGroup &&
        (!isLastMessage ||
          lastAssistantMessageHasVisibleParts ||
          isPlanningVisible);

      if (isLogoVisible) {
        messageElements.unshift(
          <div
            className="flex justify-start"
            key={`assistant-header-${message.id}`}
          >
            <Wordmark className="mt-5 mb-2 h-5.5 text-black/30 dark:text-white/30" />
          </div>,
        );
      }

      if (message.role === "user") {
        const fileAttachmentsPart = fileAttachments.find(
          (part) => part.type === "data-attachments",
        );
        const attachmentsData =
          fileAttachmentsPart?.type === "data-attachments"
            ? fileAttachmentsPart.data
            : undefined;

        // Folders auto-included from the project are split out by their source
        // and shown in a slim "from project" note instead of the hand-attached
        // card.
        const projectData =
          projectContextPart?.type === "data-projectContext"
            ? projectContextPart.data
            : undefined;
        const allFolders = attachmentsData?.folders ?? [];
        const userFolders = allFolders.filter(
          (folder) => folder.source !== "project",
        );
        const projectFolders = allFolders.filter(
          (folder) => folder.source === "project",
        );
        const files = attachmentsData?.files ?? [];

        if (files.length > 0 || userFolders.length > 0) {
          messageElements.unshift(
            <AttachmentsCard
              assetBaseUrl={assetBaseUrl}
              files={files}
              folders={userFolders}
              key={`attachments-${message.id}`}
              taskId={task.id}
            />,
          );
        }

        if (projectData) {
          messageElements.unshift(
            <ProjectContextNote
              data={projectData}
              folders={projectFolders}
              key={`project-context-${message.id}`}
            />,
          );
        }
      }

      if (message.role === "assistant" && message.metadata.error) {
        messageElements.push(
          <MessageError
            isAgentRunning={isAgentRunning}
            isDeveloperMode={isDeveloperMode}
            isLastMessage={isLastMessage}
            key={`error-${message.id}`}
            message={message}
            onContinue={onContinue}
            onModelChange={onModelChange}
            onRetry={onRetry}
            onStartNewTask={onStartNewTask}
          />,
        );
      }

      if (isLastInConsecutiveAssistantGroup) {
        const assistantMessages = regularMessages
          .slice(lastFooterIndex, messageIndex + 1)
          .filter((m) => m.role === "assistant");

        const shouldRenderFooter =
          assistantMessages.length > 0 &&
          visibleAssistantContentCount > 0 &&
          (!isLastMessage ||
            (!isAgentRunning && lastAssistantMessageHasVisibleParts));

        if (shouldRenderFooter) {
          messageElements.push(
            <AssistantMessagesFooter
              id={task.id}
              key={`assistant-footer-${message.id}`}
              messages={assistantMessages}
            />,
          );
        }

        lastFooterIndex = messageIndex + 1;
        visibleAssistantContentCount = 0;
      }

      if (renderAsItems) {
        if (messageElements.length > 0) {
          // No scrollAnchor: opting into the primitive's per-turn
          // anchor-to-top inflates a spacer and jumps the view up mid-stream
          // as tool-call DOM churns in. We only want follow-bottom +
          // release-on-scroll-up, so nothing is marked as an anchor.
          elements.push(
            <MessageScrollerItem
              className="flex flex-col gap-2"
              key={message.id}
              messageId={message.id}
            >
              {messageElements}
            </MessageScrollerItem>,
          );
        }
      } else {
        elements.push(...messageElements);
      }
    }

    return elements;
  }, [
    regularMessages,
    renderCtx,
    renderAsItems,
    runBoundaryMap,
    assetBaseUrl,
    task.id,
    isAgentRunning,
    isDeveloperMode,
    isPlanningVisible,
    lastAssistantMessageHasVisibleParts,
    onContinue,
    onModelChange,
    onRetry,
    onStartNewTask,
  ]);

  const shouldShowContinueButton = useMemo(() => {
    if (messages.length === 0 || isAgentRunning) {
      return false;
    }
    const lastMessage = messages.at(-1);
    return (
      lastMessage?.role === "assistant" &&
      lastMessage.metadata.finishReason === "max-steps"
    );
  }, [messages, isAgentRunning]);

  const contextNode =
    contextMessages.length > 0 && isDeveloperMode ? (
      <ContextMessages messages={contextMessages} />
    ) : null;

  const continueNode = shouldShowContinueButton ? (
    <Alert className="mt-4" variant="warning">
      <WarningIcon />
      <AlertDescription className="flex flex-col gap-3">
        <div className="text-xs">
          Agent was stopped due to reaching maximum unattended steps.
        </div>
        <Button onClick={onContinue} size="sm" variant="secondary">
          Resume the agent
        </Button>
      </AlertDescription>
    </Alert>
  ) : null;

  // Scroller mode emits direct children of MessageScrollerContent: each turn is
  // an anchorable item, and the surrounding chrome is wrapped so the scroller
  // still measures clean top-level rows.
  if (renderAsItems) {
    return (
      <>
        {contextNode && (
          <MessageScrollerItem key="context-messages">
            {contextNode}
          </MessageScrollerItem>
        )}
        {chatElements}
        {continueNode && (
          <MessageScrollerItem key="continue">
            {continueNode}
          </MessageScrollerItem>
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "group/assistant-message-footer",
        "flex w-full flex-col gap-2",
      )}
    >
      {contextNode}
      <div className="flex flex-col gap-2">{chatElements}</div>
      {continueNode}
    </div>
  );
}

// True once `text` stops changing for STREAM_STALL_MS. Timer-based, so it can't
// be derived declaratively: each new value arms a fresh timeout that records the
// value it settled on, and the result compares that against the current text so
// a still-growing stream never reads as stalled. Returns false when there is no
// streaming text.
function useStreamStalled(text: string | undefined) {
  const [stalledText, setStalledText] = useState<string>();
  useEffect(() => {
    if (text === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setStalledText(text);
    }, STREAM_STALL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  return text !== undefined && stalledText === text;
}
