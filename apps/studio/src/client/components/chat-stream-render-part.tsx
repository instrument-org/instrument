import {
  isToolPart,
  type SessionMessage,
  type SessionMessagePart,
  type WorkspaceAppProject,
} from "@instrument-org/workspace/client";
import { type useNavigate } from "@tanstack/react-router";

import { AssistantMessage } from "./assistant-message";
import { ToolCall } from "./message-part/tool-call";
import { isToolCallVisible } from "./message-part/tool-call-utils";
import { type RenderStream } from "./message-part/tool-task";
import { ReasoningMessage } from "./reasoning-message";
import { ContextMessage } from "./session-context-message";
import { UnknownPart } from "./unknown-part";
import { UserMessage } from "./user-message";
import { VersionAndFilesCard } from "./version-and-files-card";

export interface RenderPartContext {
  gitCommitParts: GitCommitPart[];
  hideUserMessages: boolean;
  isAgentRunning: boolean;
  isDeveloperMode: boolean;
  isToolStreaming: (
    part: SessionMessagePart.ToolPart,
    message: SessionMessage.WithParts,
  ) => boolean;
  isViewingApp: boolean;
  lastMessageId: string | undefined;
  navigate: ReturnType<typeof useNavigate>;
  onRetry: (prompt: string) => void;
  project: WorkspaceAppProject;
  renderStream: RenderStream;
  versionRef: string | undefined;
}

type GitCommitPart = Extract<
  SessionMessagePart.Type,
  { type: "data-gitCommit" }
>;

// Returns null for parts that don't render inline (kept in sync with
// `isRenderableInlinePart`).
export function renderChatPart({
  ctx,
  message,
  part,
  partIndex,
}: {
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
            assetBaseUrl={ctx.project.urls.assetBase}
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

  if (part.type === "data-gitCommit") {
    const lastGitCommitPart = ctx.gitCommitParts.at(-1);
    const isLastVersion = lastGitCommitPart?.data.ref === part.data.ref;
    const isSelected =
      ctx.versionRef === part.data.ref || (isLastVersion && !ctx.versionRef);
    const shouldSetVersion = !isSelected && !isLastVersion;

    return (
      <VersionAndFilesCard
        assetBaseUrl={ctx.project.urls.assetBase}
        className="mt-2"
        isLastGitCommit={isLastVersion}
        isSelected={isSelected}
        isViewingApp={ctx.isViewingApp}
        key={part.metadata.id}
        onVersionClick={() => {
          void ctx.navigate({
            from: "/projects/$subdomain",
            params: { subdomain: ctx.project.subdomain },
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
        projectSubdomain={ctx.project.subdomain}
        restoredFromRef={part.data.restoredFromRef}
        versionRef={part.data.ref}
      />
    );
  }

  if (part.type === "data-attachments") {
    return null;
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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (part.type === "file") {
    // eslint-disable-next-line no-console
    console.warn("File part not supported yet", part);
    return null;
  }

  const _exhaustiveCheck: never = part;
  return <UnknownPart key={partIndex} part={_exhaustiveCheck} />;
}

export function selectGitCommitParts(
  messages: SessionMessage.WithParts[],
): GitCommitPart[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part): part is GitCommitPart => part.type === "data-gitCommit",
    ),
  );
}
