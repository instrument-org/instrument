import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type StoreId,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { cn } from "../lib/utils";
import { AssistantMessage } from "./assistant-message";
import { AssistantMessagesFooter } from "./assistant-messages-footer";
import { AttachmentsCard } from "./attachments-card";
import { ContextMessages } from "./context-messages";
import { AppLogo } from "./logo";
import { MessageError } from "./message-error";
import { ToolCall } from "./message-part/tool-call";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { type RenderStream } from "./message-part/tool-task";
import { ReasoningMessage } from "./reasoning-message";
import { ContextMessage } from "./session-context-message";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { UnknownPart } from "./unknown-part";
import { UserMessage } from "./user-message";
import { VersionAndFilesCard } from "./version-and-files-card";

interface ChatStreamProps {
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isViewingApp?: boolean;
  messages: SessionMessage.WithParts[];
  onContinue: () => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onRetry: (prompt: string) => void;
  onStartNewChat: () => void;
  project: WorkspaceAppProject;
  versionRef?: string;
}

export function ChatStream({
  isAgentRunning,
  isDeveloperMode,
  isViewingApp = false,
  messages,
  onContinue,
  onModelChange,
  onRetry,
  onStartNewChat,
  project,
  versionRef,
}: ChatStreamProps) {
  const navigate = useNavigate();

  const gitCommitParts = useMemo(() => {
    return messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "data-gitCommit"),
    );
  }, [messages]);

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

  const lastMessageId = useMemo((): StoreId.Message | undefined => {
    if (regularMessages.length === 0) {
      return;
    }
    return regularMessages.at(-1)?.id;
  }, [regularMessages]);

  const renderStream: RenderStream = useCallback(
    ({ isAgentRunning: isNestedAgentRunning, messages: nestedMessages }) => (
      <ChatStream
        isAgentRunning={isNestedAgentRunning}
        isDeveloperMode={isDeveloperMode}
        isViewingApp={isViewingApp}
        messages={nestedMessages}
        onContinue={onContinue}
        onModelChange={onModelChange}
        onRetry={onRetry}
        onStartNewChat={onStartNewChat}
        project={project}
      />
    ),
    [
      isDeveloperMode,
      isViewingApp,
      onContinue,
      onModelChange,
      onRetry,
      onStartNewChat,
      project,
    ],
  );

  const isToolStreaming = useCallback(
    (part: SessionMessagePart.ToolPart, message: SessionMessage.WithParts) => {
      return (
        isAgentRunning &&
        lastMessageId === message.id &&
        (part.state === "input-streaming" ||
          part.state === "input-available" ||
          (part.state === "output-available" && part.preliminary === true))
      );
    },
    [isAgentRunning, lastMessageId],
  );

  const renderChatPart = useCallback(
    (
      part: SessionMessagePart.Type,
      message: SessionMessage.WithParts,
      partIndex: number,
    ): null | React.ReactNode => {
      if (part.type === "text") {
        if (part.state === "done" && part.text.trim() === "") {
          return null;
        }

        switch (message.role) {
          case "assistant": {
            return (
              <AssistantMessage
                assetBaseUrl={project.urls.assetBase}
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

      if (part.type === "data-gitCommit") {
        const lastGitCommitPart = gitCommitParts.at(-1);
        const isLastVersion = lastGitCommitPart?.data.ref === part.data.ref;
        const isSelected =
          versionRef === part.data.ref || (isLastVersion && !versionRef);
        const shouldSetVersion = !isSelected && !isLastVersion;

        return (
          <VersionAndFilesCard
            assetBaseUrl={project.urls.assetBase}
            className="mt-2"
            isLastGitCommit={isLastVersion}
            isSelected={isSelected}
            isViewingApp={isViewingApp}
            key={part.metadata.id}
            onVersionClick={() => {
              void navigate({
                from: "/projects/$subdomain",
                params: { subdomain: project.subdomain },
                replace: true,
                search: (prev) => ({
                  ...prev,
                  artifactPanel: {
                    type: "app",
                    versionRef: shouldSetVersion ? part.data.ref : undefined,
                  },
                }),
              });
            }}
            projectSubdomain={project.subdomain}
            restoredFromRef={part.data.restoredFromRef}
            versionRef={part.data.ref}
          />
        );
      }

      if (part.type === "data-attachments") {
        return null;
      }

      if (isToolPart(part)) {
        const streaming = isToolStreaming(part, message);
        if (
          !isToolCallVisible({
            isDeveloperMode,
            isStreaming: streaming,
            part,
          })
        ) {
          return null;
        }

        return (
          <div key={part.metadata.id}>
            <ToolCall
              isAgentRunning={isAgentRunning}
              isDeveloperMode={isDeveloperMode}
              isStreaming={streaming}
              part={part}
              project={project}
              renderStream={renderStream}
            />
          </div>
        );
      }

      if (part.type === "reasoning") {
        return (
          <div className="py-1" key={part.metadata.id}>
            <ReasoningMessage
              createdAt={part.metadata.createdAt}
              endedAt={part.metadata.endedAt}
              isLoading={
                isAgentRunning &&
                lastMessageId === message.id &&
                part.state === "streaming"
              }
              text={part.text}
            />
          </div>
        );
      }

      if (part.type === "source-document" || part.type === "source-url") {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (part.type === "file") {
        // eslint-disable-next-line no-console
        console.warn("File part not supported yet", part);
        return null;
      }

      const _exhaustiveCheck: never = part;
      return <UnknownPart key={partIndex} part={_exhaustiveCheck} />;
    },
    [
      gitCommitParts,
      versionRef,
      project,
      navigate,
      isDeveloperMode,
      isAgentRunning,
      lastMessageId,
      isToolStreaming,
      isViewingApp,
      renderStream,
    ],
  );

  const hasActiveLoadingState = useMemo(() => {
    if (!isAgentRunning || regularMessages.length === 0) {
      return false;
    }

    const lastMessage = regularMessages.at(-1);
    if (!lastMessage || lastMessage.id !== lastMessageId) {
      return false;
    }

    const lastPart = lastMessage.parts.at(-1);
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
  }, [isAgentRunning, regularMessages, lastMessageId]);

  const isPlanningVisible = isAgentRunning && !hasActiveLoadingState;

  const lastAssistantMessageHasVisibleParts = useMemo(() => {
    const lastMessage = regularMessages.at(-1);
    if (!lastMessage || lastMessage.role !== "assistant") {
      return false;
    }
    return lastMessage.parts.some((part) =>
      isVisibleAssistantPart({
        isDeveloperMode,
        isStreaming: isToolPart(part)
          ? isToolStreaming(part, lastMessage)
          : false,
        part,
      }),
    );
  }, [regularMessages, isDeveloperMode, isToolStreaming]);

  const { chatElements } = useMemo(() => {
    const newChatElements: React.ReactNode[] = [];
    let lastFooterIndex = 0;
    let visibleAssistantContentCount = 0;

    for (const [messageIndex, message] of regularMessages.entries()) {
      const messageElements: React.ReactNode[] = [];
      const seenSourceIds = new Set<string>();
      const fileAttachments: SessionMessagePart.Type[] = [];

      for (const [partIndex, part] of message.parts.entries()) {
        if (
          (part.type === "source-document" || part.type === "source-url") &&
          seenSourceIds.has(part.sourceId)
        ) {
          continue;
        }
        if (part.type === "source-document" || part.type === "source-url") {
          seenSourceIds.add(part.sourceId);
          continue;
        }

        if (message.role === "user" && part.type === "data-attachments") {
          fileAttachments.push(part);
          continue;
        }

        const rendered = renderChatPart(part, message, partIndex);
        if (rendered) {
          messageElements.push(rendered);
          if (message.role === "assistant") {
            visibleAssistantContentCount++;
          }
        }
      }

      const prevMessage = regularMessages[messageIndex - 1];
      const nextMessage = regularMessages[messageIndex + 1];
      const isFirstInConsecutiveGroup =
        message.role === "assistant" &&
        (!prevMessage || prevMessage.role !== "assistant");
      const isLastInConsecutiveGroup =
        message.role === "assistant" &&
        (!nextMessage || nextMessage.role !== "assistant");

      const isLastMessage = messageIndex === regularMessages.length - 1;
      const isLogoVisible =
        isFirstInConsecutiveGroup &&
        (!isLastMessage ||
          lastAssistantMessageHasVisibleParts ||
          isPlanningVisible);

      if (isLogoVisible) {
        messageElements.unshift(
          <div
            className="flex justify-start"
            key={`assistant-header-${message.id}`}
          >
            <AppLogo className="mt-5 mb-4 h-5.5 text-black/30 dark:text-white/30" />
          </div>,
        );
      }

      if (message.role === "user" && fileAttachments.length > 0) {
        const fileAttachmentsPart = fileAttachments.find(
          (part) => part.type === "data-attachments",
        );

        if (fileAttachmentsPart) {
          const files = fileAttachmentsPart.data.files;

          messageElements.unshift(
            <AttachmentsCard
              assetBaseUrl={project.urls.assetBase}
              files={files}
              folders={fileAttachmentsPart.data.folders}
              key={`attachments-${message.id}`}
              projectSubdomain={project.subdomain}
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
            onStartNewChat={onStartNewChat}
          />,
        );
      }

      if (isLastInConsecutiveGroup) {
        const assistantMessagesForFooter = regularMessages.slice(
          lastFooterIndex,
          messageIndex + 1,
        );
        const assistantMessages = assistantMessagesForFooter.filter(
          (m) => m.role === "assistant",
        );

        const isLastMessageGroup = messageIndex === regularMessages.length - 1;
        const shouldRenderFooter =
          assistantMessages.length > 0 &&
          visibleAssistantContentCount > 0 &&
          (!isLastMessageGroup ||
            (!isAgentRunning && lastAssistantMessageHasVisibleParts));

        if (shouldRenderFooter) {
          messageElements.push(
            <AssistantMessagesFooter
              key={`assistant-footer-${message.id}`}
              messages={assistantMessages}
              subdomain={project.subdomain}
            />,
          );
        }

        lastFooterIndex = messageIndex + 1;
        visibleAssistantContentCount = 0;
      }

      newChatElements.push(...messageElements);
    }

    return { chatElements: newChatElements };
  }, [
    project.urls.assetBase,
    project.subdomain,
    regularMessages,
    renderChatPart,
    isAgentRunning,
    isPlanningVisible,
    lastAssistantMessageHasVisibleParts,
    isDeveloperMode,
    onContinue,
    onModelChange,
    onRetry,
    onStartNewChat,
  ]);

  const shouldShowContinueButton = useMemo(() => {
    if (messages.length === 0 || isAgentRunning) {
      return false;
    }

    const lastMessage = messages.at(-1);
    return (
      lastMessage &&
      lastMessage.role === "assistant" &&
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
        <div
          className={cn(
            "flex animate-in items-center gap-2 delay-500 fill-mode-both fade-in",
            lastAssistantMessageHasVisibleParts && "mt-6",
          )}
        >
          <span className="size-3 shrink-0 rounded-full bg-brand-500" />
          <span className="shiny-text text-sm font-medium">Planning...</span>
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

function isActiveToolPart(part: SessionMessagePart.ToolPart) {
  return (
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "output-available" && part.preliminary === true)
  );
}

function isVisibleAssistantPart({
  isDeveloperMode,
  isStreaming,
  part,
}: {
  isDeveloperMode: boolean;
  isStreaming: boolean;
  part: SessionMessagePart.Type;
}) {
  if (part.type === "text") {
    return part.state !== "done" || part.text.trim() !== "";
  }

  if (isToolPart(part)) {
    return isToolCallVisible({ isDeveloperMode, isStreaming, part });
  }

  return (
    part.type !== "step-start" &&
    part.type !== "data-attachments" &&
    part.type !== "source-document" &&
    part.type !== "source-url" &&
    part.type !== "file"
  );
}
