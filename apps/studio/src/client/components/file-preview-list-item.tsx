import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import { ImageWithFallback } from "./image-with-fallback";
import { PreviewListItem } from "./preview-list-item";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function FilePreviewListItem({
  file,
  isSelected = false,
  onClick,
}: {
  file: TaskFileViewerFile;
  isSelected?: boolean;
  onClick: () => void;
}) {
  const { filename, filePath, mimeType } = file;
  const fileType = getFileType(file);
  const { url } = file;
  const [imageLoadError, setImageLoadError] = useState(false);
  const fileActions = useFileActionVisibility(file);
  const hasFileActions =
    fileActions.showCopy || fileActions.showDownload || fileActions.showReveal;

  const content =
    url && fileType === "image" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The surface its sibling row takes, squared off, so the two kinds of
              chip in one row sit on the same thing. Styled here rather than
              borrowed from a button variant for the same reason the row is. The
              selected mark goes outside because the image covers the surface a
              tint would land on. */}
          <button
            className={cn(
              "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/5 bg-background shadow-xs dark:border-white/6",
              "transition-[outline] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-0 focus-visible:outline-ring/50 focus-visible:[outline-style:solid]",
              isSelected &&
                "outline-2 outline-solid outline-offset-2 outline-brand-100 dark:outline-brand-700",
            )}
            onClick={onClick}
            type="button"
          >
            <ImageWithFallback
              alt={filename}
              className="size-12 object-cover"
              fallbackClassName="size-12 rounded-lg"
              filename={filename}
              onError={() => {
                setImageLoadError(true);
              }}
              showCheckerboard
              src={url}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="wrap-break-word"
          collisionPadding={10}
          maxWidth="500px"
        >
          {filePath}
        </TooltipContent>
      </Tooltip>
    ) : (
      <PreviewListItem
        icon={
          <FileIcon
            className="size-5 shrink-0 text-muted-foreground"
            filename={filename}
            mimeType={mimeType}
          />
        }
        isSelected={isSelected}
        label={filename}
        onClick={onClick}
        tooltipContent={filePath}
      />
    );

  if (!hasFileActions) {
    return content;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems
          canCopy={!imageLoadError}
          file={file}
          menuComponents={contextMenuComponents}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
