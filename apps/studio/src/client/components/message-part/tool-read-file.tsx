import {
  type SessionMessagePart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ChatIcon } from "@phosphor-icons/react/Chat";
import { useSetAtom } from "jotai";

import { appendToPromptAtom } from "../../atoms/prompt-value";
import { useTaskPaneActions } from "../../hooks/use-task-pane";
import { filenameFromFilePath } from "../../lib/path-utils";
import { FileIcon } from "../file-icon";
import { IconButton } from "../icon-button";
import { ImageWithFallback } from "../image-with-fallback";
import { FileToolCard } from "./file-tool-card";

type ReadFilePart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-read_file" }
>;

type UnsupportedFormatReason = Extract<
  ReadFilePart["output"],
  { state: "unsupported-format" }
>["reason"];

/**
 * One line per reason the tool can refuse a file.
 *
 * Typed off the tool's own union rather than defaulted, so adding a reason in
 * the workspace fails the build here instead of quietly rendering as "Cannot
 * read binary file" -- which is how a truncated PDF and a valid-but-oversized
 * photo both came to be described to the user as binary files.
 */
const UNSUPPORTED_FORMAT_MESSAGES: Record<UnsupportedFormatReason, string> = {
  "binary-file": "Cannot read binary file",
  "image-too-large": "Image is too large to open",
  "truncated-image": "Image is incomplete",
  "undecodable-image": "File is not a readable image",
  "undecodable-media": "Cannot read this audio or video file",
  "undecodable-pdf": "PDF is incomplete",
  "unsupported-image-format": "Unsupported image format",
};

export function ToolReadFile({ id, part }: { id: TaskId; part: ReadFilePart }) {
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
          id={id}
          modifiedAt={output.modifiedAt}
        >
          <audio className="w-full" controls src={src} />
        </ReadFileCard>
      );
    }
    case "does-not-exist": {
      return (
        <ReadFileCard filePath={output.filePath} id={id}>
          <p className="text-xs text-muted-foreground">File not found</p>
        </ReadFileCard>
      );
    }
    case "exists": {
      return (
        <FileToolCard
          content={output.content}
          filePath={output.filePath}
          id={id}
          modifiedAt={output.modifiedAt}
        />
      );
    }
    case "image": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      const filename = filenameFromFilePath(output.filePath);
      const { region } = output;
      return (
        <ReadFileCard
          filePath={output.filePath}
          id={id}
          modifiedAt={output.modifiedAt}
          note={
            region
              ? `zoomed to (${region.x1},${region.y1})-(${region.x2},${region.y2})`
              : undefined
          }
          openOnContentClick
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
          id={id}
        />
      );
    }
    case "pdf": {
      const src = `data:${output.mimeType};base64,${output.base64Data}`;
      return (
        <ReadFileCard
          filePath={output.filePath}
          id={id}
          modifiedAt={output.modifiedAt}
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
      const message = UNSUPPORTED_FORMAT_MESSAGES[output.reason];
      return (
        <ReadFileCard
          filePath={output.filePath}
          id={id}
          modifiedAt={output.modifiedAt}
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
          id={id}
          modifiedAt={output.modifiedAt}
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
  id,
  modifiedAt,
  note,
  openOnContentClick = false,
}: {
  children: React.ReactNode;
  filePath: string;
  id: TaskId;
  modifiedAt?: number;
  note?: string;
  openOnContentClick?: boolean;
}) {
  const filename = filenameFromFilePath(filePath);
  const appendToPrompt = useSetAtom(appendToPromptAtom);
  const { openFiles } = useTaskPaneActions(id);

  const handleAddToChat = () => {
    appendToPrompt({ key: { scope: "task", taskId: id }, update: filePath });
  };

  const handleExpand = () => {
    if (modifiedAt === undefined) {
      return;
    }
    openFiles([filePath]);
  };

  return (
    <div className="relative mt-2 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon
            className="size-3 shrink-0 text-muted-foreground"
            filename={filename}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {filename}
          </span>
          {note && (
            <span className="truncate text-xs text-muted-foreground/70">
              {note}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <IconButton
            className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
            icon={ChatIcon}
            onClick={handleAddToChat}
            tooltip="Add to chat"
            variant="ghost"
          />
          {modifiedAt !== undefined && (
            <IconButton
              className="size-5 shrink-0 p-0.5 text-foreground/50 hover:text-foreground/80"
              icon={ArrowsOutSimpleIcon}
              onClick={handleExpand}
              tooltip="Open in panel"
              variant="ghost"
            />
          )}
        </div>
      </div>
      {openOnContentClick && modifiedAt !== undefined ? (
        <button
          aria-label={`Open ${filename} in panel`}
          className="block w-full cursor-zoom-in px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          onClick={handleExpand}
          type="button"
        >
          {children}
        </button>
      ) : (
        <div className="px-4 py-3">{children}</div>
      )}
    </div>
  );
}
