import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useLiveAssetUrl } from "@/client/components/task/current-task-files";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { getFileType } from "@/client/lib/get-file-type";
import { cn } from "@/client/lib/utils";
import { useState } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import { FileIcon } from "./file-icon";
import { ImageWithFallback } from "./image-with-fallback";
import { PreviewListItem } from "./preview-list-item";
import { Button } from "./ui/button";
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
  const url = useLiveAssetUrl(file);
  const [imageLoadError, setImageLoadError] = useState(false);
  const fileActions = useFileActionVisibility(file);
  const hasFileActions =
    fileActions.showCopy || fileActions.showDownload || fileActions.showReveal;

  const content =
    url && fileType === "image" ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "relative size-12 shrink-0 overflow-hidden p-0",
              isSelected &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            onClick={onClick}
            type="button"
            variant="outline"
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
          </Button>
        </TooltipTrigger>
        <TooltipContent
          className="max-w-[min(500px,90vw)] wrap-break-word"
          collisionPadding={10}
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
