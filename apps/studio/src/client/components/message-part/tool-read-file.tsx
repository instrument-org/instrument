import {
  type ProjectSubdomain,
  type SessionMessagePart,
} from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon, ChatIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { filenameFromFilePath } from "../../lib/path-utils";
import { ConfirmedIconButton } from "../confirmed-icon-button";
import { FileIcon } from "../file-icon";
import { ImageWithFallback } from "../image-with-fallback";
import { useCurrentProjectFile } from "../project/current-project-files";
import { FileToolCard } from "./file-tool-card";

type ReadFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-read_file" }
>;

export function ToolReadFile({
  part,
  subdomain,
}: {
  part: ReadFilePart;
  subdomain: ProjectSubdomain;
}) {
  if (part.state !== "output-available") {
    return null;
  }

  const { output } = part;

  switch (output.state) {
    case "audio": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      return (
        <ReadFileCard
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        >
          <audio className="w-full" controls src={src} />
        </ReadFileCard>
      );
    }
    case "does-not-exist": {
      return (
        <ReadFileCard filePath={output.filePath} subdomain={subdomain}>
          <p className="text-xs text-muted-foreground">File not found</p>
        </ReadFileCard>
      );
    }
    case "exists": {
      return (
        <FileToolCard
          content={output.content}
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        />
      );
    }
    case "image": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      const filename = filenameFromFilePath(output.filePath);
      return (
        <ReadFileCard
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        >
          <div className="flex items-center justify-center">
            <ImageWithFallback
              alt={output.filePath}
              className="max-h-96 w-auto rounded-lg object-contain"
              fallbackClassName="min-h-32 w-full"
              filename={filename}
              src={src}
            />
          </div>
        </ReadFileCard>
      );
    }
    case "is-directory": {
      return (
        <FileToolCard
          content={output.entries.join("\n")}
          filePath={output.filePath}
          subdomain={subdomain}
        />
      );
    }
    case "pdf": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      return (
        <ReadFileCard
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        >
          <iframe
            className="h-96 w-full rounded-lg"
            src={src}
            title={output.filePath}
          />
        </ReadFileCard>
      );
    }
    case "unsupported-format": {
      const message =
        output.reason === "unsupported-image-format"
          ? "Unsupported image format"
          : "Cannot read binary file";
      return (
        <ReadFileCard
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        >
          <p className="text-xs text-muted-foreground">{message}</p>
        </ReadFileCard>
      );
    }
    case "video": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      return (
        <ReadFileCard
          filePath={output.filePath}
          modifiedAt={output.modifiedAt}
          subdomain={subdomain}
        >
          <video className="max-h-96 w-full rounded-lg" controls src={src} />
        </ReadFileCard>
      );
    }
    default: {
      output satisfies never;
      return null;
    }
  }
}

function ReadFileCard({
  children,
  filePath,
  modifiedAt,
  subdomain,
}: {
  children: React.ReactNode;
  filePath: string;
  modifiedAt?: number;
  subdomain: ProjectSubdomain;
}) {
  const filename = filenameFromFilePath(filePath);
  const currentFile = useCurrentProjectFile(filePath);
  const isStale =
    modifiedAt !== undefined &&
    currentFile !== undefined &&
    currentFile.modifiedAt !== modifiedAt;
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const navigate = useNavigate({ from: "/projects/$subdomain" });

  const handleAddToChat = () => {
    appendToPrompt({ key: subdomain, update: filePath });
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

  return (
    <div className="relative mt-2 overflow-hidden rounded-2xl border border-border bg-card">
      {isStale && (
        <span className="absolute right-3 bottom-3 z-10 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm">
          Updated since this message
        </span>
      )}
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
          {modifiedAt !== undefined && (
            <ConfirmedIconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={ArrowsOutSimpleIcon}
              onClick={handleExpand}
              successTooltip="Opened!"
              tooltip="Open in panel"
              variant="ghost"
            />
          )}
        </div>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}
