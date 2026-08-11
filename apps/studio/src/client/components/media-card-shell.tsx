import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { cn } from "@/client/lib/utils";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const INTERACTIVE_DELAY_MS = 300;
const VISIBLE_DELAY_MS = 400;

export function MediaCardShell({
  bottomBar,
  canCopy,
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
  bottomBar?: React.ReactNode;
  canCopy?: boolean;
  children: React.ReactNode;
  file: TaskFileViewerFile;
  hideActionsMenu?: boolean;
  isSelected?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  overlayActions?: React.ReactNode;
  scrim?: React.ReactNode;
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
            // isolate: the scrim, the overlay actions and the video's progress
            // bar stack against each other and nothing else. Without it they
            // join whatever stacking context the page happens to give them and
            // outrank chrome that is nowhere near this card.
            //
            // Square whatever the media inside it is. The grid lays these out
            // several to a row, so a card that took its own shape would set the
            // row's height by whichever of them happened to be tallest -- and
            // that height would then change as the rest of the row arrived.
            // A video letterboxes into the square instead.
            "group/media relative isolate aspect-square w-full overflow-hidden rounded-2xl bg-card shadow-sm dark:bg-muted",
            isSelected &&
              "outline-2 outline-offset-2 outline-brand-100 dark:outline-brand-700",
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {children}

          <div className="opacity-0 transition-opacity duration-200 group-hover/media:opacity-100 group-has-[button[data-state=open]]/media:opacity-100">
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
                "text-white opacity-0 drop-shadow-sm transition-opacity duration-200 group-hover/media:opacity-100 group-has-[button[data-state=open]]/media:opacity-100",
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
                // The box spans the card's full width so a long "Open in…"
                // label truncates instead of running under the expand control,
                // but only the controls inside it may take the pointer. Left
                // clickable, the empty space beside them swallows presses meant
                // for the card, and the box covers the expand control too.
                "pointer-events-none absolute top-3 right-3 left-3 z-10 flex flex-col items-start gap-1",
                "opacity-0 transition-opacity duration-200 group-hover/media:opacity-100 group-hover/media:delay-400 group-has-[button[data-state=open]]/media:opacity-100 group-has-[button[data-state=open]]/media:delay-0",
                interactive && "[&>*]:pointer-events-auto",
                "group-has-[button[data-state=open]]/media:[&>*]:pointer-events-auto",
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
        <FileActionsMenuItems
          canCopy={canCopy}
          file={file}
          menuComponents={contextMenuComponents}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
