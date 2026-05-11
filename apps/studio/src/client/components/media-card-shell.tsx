import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { cn } from "@/client/lib/utils";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";

import { FileActionsMenuItems } from "./file-actions-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function MediaCardShell({
  aspectRatio,
  bottomBar,
  children,
  file,
  hideActionsMenu,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
  overlayActions,
  scrim,
}: {
  aspectRatio: "square" | "video";
  bottomBar?: React.ReactNode;
  children: React.ReactNode;
  file: ProjectFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  overlayActions?: React.ReactNode;
  scrim?: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative w-full overflow-hidden rounded-2xl bg-card shadow-sm dark:bg-muted",
            aspectRatio === "square" ? "aspect-square" : "aspect-video",
            isSelected &&
              "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {children}

          {scrim}

          <button
            className="absolute inset-0 z-0 size-full"
            onClick={onClick}
            type="button"
          />

          {!hideActionsMenu && (
            <button
              className={cn(
                "absolute top-3 right-3 z-10 flex size-7 items-center justify-center",
                "text-white opacity-0 drop-shadow-sm transition-opacity duration-200",
                "group-hover:opacity-100",
              )}
              onClick={onClick}
              type="button"
            >
              <ArrowsOutSimpleIcon className="size-3.5" />
            </button>
          )}

          {overlayActions && (
            <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {overlayActions}
            </div>
          )}

          {bottomBar}

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="pointer-events-none absolute inset-0" />
            </TooltipTrigger>
            <TooltipContent>
              <span className="break-all">{file.filePath}</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems file={file} variant="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
