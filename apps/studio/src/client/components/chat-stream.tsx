import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  browserStatusModelNote,
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type Task,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";
import { useCallback, useMemo } from "react";

import { getAssetBaseUrl } from "../lib/asset-base-url";
import { cn } from "../lib/utils";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import {
  renderChatPart,
  type RenderPartContext,
} from "./chat-stream-render-part";
import {
  buildToolBoundaryMap,
  isActiveToolPart,
  isVisibleAssistantPart,
} from "./chat-stream-utils";
import { ContextMessages } from "./context-messages";
import { MessageError } from "./message-error";
import { type RenderStream } from "./message-part/tool-agent";
import { ProjectContextNote } from "./project-context-note";
import { ReasoningMessage } from "./reasoning-message";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Wordmark } from "./wordmark";

interface ChatStreamProps {
  hideLogo?: boolean;
  hideUserMessages?: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onStartNewTask: () => void;
  task: Task;
}

export function ChatStream({
  hideLogo = false,
  hideUserMessages = false,
  isAgentRunning,
  isDeveloperMode,
  messages,
  onContinue,
  onModelChange,
  onRetry,
  onStartNewTask,
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

  const renderStream: RenderStream = useCallback(
    ({ isAgentRunning: isNestedAgentRunning, messages: nestedMessages }) => (
      <ChatStream
        hideLogo
        hideUserMessages
        isAgentRunning={isNestedAgentRunning}
        isDeveloperMode={isDeveloperMode}
        messages={nestedMessages}
        onContinue={onContinue}
        onModelChange={onModelChange}
        onRetry={onRetry}
        onStartNewTask={onStartNewTask}
        task={task}
      />
    ),
    [isDeveloperMode, onContinue, onModelChange, onRetry, onStartNewTask, task],
  );

  const isToolStreaming = useCallback(
    (part: SessionMessagePart.ToolPart, message: SessionMessage.WithParts) =>
      isAgentRunning && lastMessageId === message.id && isActiveToolPart(part),
    [isAgentRunning, lastMessageId],
  );

  // When a run emits several tool calls at once they are all active, but only
  // the first visible still-active one is the "current" call. Upcoming calls
  // stay collapsed so the run reveals top-to-bottom instead of all expanding at
  // once.
  const currentToolId = useMemo(() => {
    if (!isAgentRunning) {
      return;
    }
    return lastRegularMessage?.parts.find(
      (part) =>
        isToolPart(part) &&
        isActiveToolPart(part) &&
        isVisibleAssistantPart({
          isDeveloperMode,
          isStreaming: true,
          part,
        }),
    )?.metadata.id;
  }, [isAgentRunning, isDeveloperMode, lastRegularMessage]);

  const hasActiveLoadingState = useMemo(() => {
    if (!isAgentRunning || !lastAssistantMessage) {
      return false;
    }

    const lastPart = lastAssistantMessage.parts.at(-1);
    if (!lastPart) {
      return false;
    }
    if (lastPart.type === "text" && lastPart.state !== "done") {
      return true;
    }
    if (isToolPart(lastPart)) {
      return isActiveToolPart(lastPart);
    }
    if (lastPart.type === "reasoning" && lastPart.state === "streaming") {
      return true;
    }
    return false;
  }, [isAgentRunning, lastAssistantMessage]);

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

  // Precomputed so tool-run edges can span message boundaries.
  const toolBoundaryMap = useMemo(
    () =>
      buildToolBoundaryMap({
        hideUserMessages,
        isDeveloperMode,
        isToolStreaming,
        regularMessages,
      }),
    [hideUserMessages, isDeveloperMode, isToolStreaming, regularMessages],
  );

  const renderCtx: RenderPartContext = useMemo(
    () => ({
      assetBaseUrl,
      currentToolId,
      hideUserMessages,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      renderStream,
      task,
    }),
    [
      assetBaseUrl,
      currentToolId,
      hideUserMessages,
      isAgentRunning,
      isDeveloperMode,
      isToolStreaming,
      lastMessageId,
      onRetry,
      task,
      renderStream,
    ],
  );

  const chatElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let previousBrowserStatusNote: string | undefined;
    let visibleAssistantContentCount = 0;

    for (const [messageIndex, message] of regularMessages.entries()) {
      const messageElements: React.ReactNode[] = [];

      const prevMessage = regularMessages[messageIndex - 1];
      const nextMessage = regularMessages[messageIndex + 1];
      const isFirstInConsecutiveAssistantGroup =
        message.role === "assistant" &&
        (prevMessage?.role !== "assistant");
      const isLastInConsecutiveAssistantGroup =
        message.role === "assistant" &&
        (nextMessage?.role !== "assistant");
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

        const boundary = toolBoundaryMap.get(part.metadata.id);
        if (boundary?.isToolCall) {
          messageElements.push(
            <div
              className={cn(
                !boundary.prevIsToolCall && "mt-2",
                !boundary.nextIsToolCall && "mb-2",
              )}
              key={`tool-wrap-${part.metadata.id}`}
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

      // --- Per-message chrome ---

      const isLogoVisible =
        !hideLogo &&
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

      if (!hideUserMessages && message.role === "user") {
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

      elements.push(...messageElements);
    }

    return elements;
  }, [
    regularMessages,
    renderCtx,
    toolBoundaryMap,
    hideLogo,
    hideUserMessages,
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

  return (
    <div
      className={cn(
        "group/assistant-message-footer",
        "flex w-full flex-col gap-2",
      )}
    >
      {contextMessages.length > 0 && isDeveloperMode && (
        <ContextMessages messages={contextMessages} />
      )}
      <div className="flex flex-col gap-2">{chatElements}</div>

      {isPlanningVisible && (
        <div className={cn(lastAssistantMessageHasVisibleParts && "mt-1")}>
          <ReasoningMessage
            isLoading
            noDelay={!lastAssistantMessageHasVisibleParts}
            text=""
          />
        </div>
      )}

      {shouldShowContinueButton && (
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
      )}
    </div>
  );
}
