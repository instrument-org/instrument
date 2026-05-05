import { type ProjectSubdomain } from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon, ChatIcon, CopyIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { getLanguageFromFilePath } from "../../lib/file-extension-to-language";
import { filenameFromFilePath } from "../../lib/path-utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { VirtualizedScrollingText } from "../tool-part/virtualized-scrolling-text";

export function FileToolCard({
  content,
  filePath,
  isStreaming,
  language,
  subdomain,
}: {
  content: string;
  filePath: string;
  isStreaming: boolean;
  language?: string;
  subdomain: ProjectSubdomain;
}) {
  const filename = filenameFromFilePath(filePath);
  const detectedLanguage = language ?? getLanguageFromFilePath(filePath);
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/projects/$subdomain" });

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
    appendToPrompt({ key: subdomain, update: filePath });
  };

  const handleExpand = () => {
    void navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        artifactPanel: { filePath, type: "file" as const },
      }),
    });
  };

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon
            className="size-3 shrink-0 text-muted-foreground"
            filename={filename}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {filename}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <ConfirmedIconButton
            className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
            icon={ChatIcon}
            onClick={handleAddToChat}
            successTooltip="Added!"
            tooltip="Add to chat"
            variant="ghost"
          />
          <ConfirmedIconButton
            className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
            icon={ArrowsOutSimpleIcon}
            onClick={handleExpand}
            successTooltip="Opened!"
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
      </div>

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
    </div>
  );
}
