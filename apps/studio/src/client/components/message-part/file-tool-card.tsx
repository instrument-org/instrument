import { type TaskId } from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon, ChatIcon, CopyIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { getLanguageFromFilePath } from "../../lib/file-extension-to-language";
import { filenameFromFilePath } from "../../lib/path-utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { IconButton } from "../icon-button";
import { VirtualizedScrollingText } from "../tool-part/virtualized-scrolling-text";
import { useToolCallSession } from "./tool-call-session";
import { ToolCard, ToolCardHeader } from "./tool-card";

export function FileToolCard({
  content,
  filePath,
  id,
  language,
  modifiedAt,
}: {
  content: string;
  filePath: string;
  id: TaskId;
  language?: string;
  modifiedAt?: number;
}) {
  const { isStreaming } = useToolCallSession();

  const filename = filenameFromFilePath(filePath);
  const detectedLanguage = language ?? getLanguageFromFilePath(filePath);
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/tasks/$id" });

  const cleanedContent =
    !isStreaming && content.endsWith("\n") ? content.slice(0, -1) : content;

  const { highlightedHtml } = useSyntaxHighlighting({
    code: cleanedContent || undefined,
    language: detectedLanguage,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cleanedContent);
  };

  const handleAddToChat = () => {
    appendToPrompt({ key: id, update: filePath });
  };

  const handleExpand = () => {
    if (modifiedAt === undefined) {
      return;
    }
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, modifiedAt, type: "file" as const },
      }),
    });
  };

  if (!content) {
    return null;
  }

  return (
    <ToolCard>
      <ToolCardHeader className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon
            className="size-3 shrink-0 text-muted-foreground"
            filename={filename}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {filename}
          </span>
        </div>

        {!isStreaming && modifiedAt !== undefined && (
          <div className="flex shrink-0 items-center gap-3">
            <IconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={ChatIcon}
              onClick={handleAddToChat}
              tooltip="Add to chat"
              variant="ghost"
            />
            <IconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={ArrowsOutSimpleIcon}
              onClick={handleExpand}
              tooltip="Open in panel"
              variant="ghost"
            />
            <ConfirmedIconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={CopyIcon}
              onClick={handleCopy}
              successTooltip="Copied!"
              tooltip="Copy"
              variant="ghost"
            />
          </div>
        )}
      </ToolCardHeader>

      <div className="px-4 py-3">
        <VirtualizedScrollingText
          autoScrollToBottom={isStreaming}
          content={cleanedContent}
          highlightedLines={
            highlightedHtml && highlightedHtml.length > 0
              ? highlightedHtml
              : undefined
          }
        />
      </div>
    </ToolCard>
  );
}
