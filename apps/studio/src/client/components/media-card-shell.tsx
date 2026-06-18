import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { cn } from "@/client/lib/utils";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const INTERACTIVE_DELAY_MS = 300;
const VISIBLE_DELAY_MS = 400;

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
  statusLabel,
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
  statusLabel?: string;
}) {
  const [interactive, setInteractive] = useState(false);
  const hoverStartRef = useRef<null | number>(null);
  const timerRef = useRef<null | number>(null);

  const handleMouseEnter = () => {
    hoverStartRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      setInteractive(true);
    }, INTERACTIVE_DELAY_MS);
    onMouseEnter?.();
  };

  const handleMouseLeave = () => {
    hoverStartRef.current = null;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setInteractive(false);
    onMouseLeave?.();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative w-full overflow-hidden rounded-2xl bg-card shadow-sm dark:bg-muted",
            aspectRatio === "square" ? "aspect-square" : "aspect-video",
            isSelected &&
              "outline-2 outline-offset-2 outline-brand-100 dark:outline-brand-700",
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}

          <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {scrim}
          </div>

          <button
            className="absolute inset-0 z-0 size-full"
            onClick={onClick}
            type="button"
          />

          {!hideActionsMenu && (
            <button
              className={cn(
                "absolute top-3 right-3 z-10 flex size-7 items-center justify-center",
                "text-white opacity-0 drop-shadow-sm transition-opacity duration-200 group-hover:opacity-100",
              )}
              onClick={onClick}
              type="button"
            >
              <ArrowsOutSimpleIcon className="size-3.5" />
            </button>
          )}

          {overlayActions && (
            <div
              className={cn(
                "absolute top-3 left-3 z-10 flex flex-col items-start gap-1",
                "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-hover:delay-400",
                !interactive && "pointer-events-none",
              )}
              onClickCapture={(e) => {
                // block mouseup-race clicks that started before the protection window
                if (
                  hoverStartRef.current !== null &&
                  Date.now() - hoverStartRef.current < VISIBLE_DELAY_MS
                ) {
                  e.stopPropagation();
                }
              }}
            >
              {overlayActions}
            </div>
          )}

          {bottomBar}

          {statusLabel && (
            <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm">
              {statusLabel}
            </div>
          )}

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
