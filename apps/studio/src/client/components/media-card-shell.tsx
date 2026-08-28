import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import { cn } from "@/client/lib/utils";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { useRef, useState } from "react";

import { FileActionsMenuItems } from "./file-actions-menu";
import { MEDIA_CARD_ASPECT, type MediaCardShape } from "./media-card-shape";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

// When the overlay controls may take the pointer, derived from when they finish
// arriving rather than picked separately -- the two numbers disagreeing is the
// bug this is shaped to prevent. A card is usually crossed rather than aimed at,
// and a press during that crossing means "open this", so a control that is not
// yet on screen must not be able to answer for one. Both must match the reveal
// spelled out on the overlay box below (`delay-400 duration-200`).
const REVEAL_DELAY_MS = 400;
const REVEAL_DURATION_MS = 200;
const ARMED_DELAY_MS = REVEAL_DELAY_MS + REVEAL_DURATION_MS;

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
  shape = "square",
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
  shape?: MediaCardShape;
}) {
  const [interactive, setInteractive] = useState(false);
  const hoverStartRef = useRef<null | number>(null);
  const timerRef = useRef<null | number>(null);
  const dragProps = useFileDrag(file);

  const handleMouseEnter = () => {
    hoverStartRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      setInteractive(true);
    }, ARMED_DELAY_MS);
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
            // One of two fixed shapes, never the media's own. The grid lays
            // these out several to a row, so a card that took its own shape
            // would set the row's height by whichever of them happened to be
            // tallest -- and that height would then change as the rest of the
            // row arrived. The media letterboxes into the box instead.
            "group/media relative isolate w-full overflow-hidden rounded-2xl bg-card shadow-sm dark:bg-muted",
            MEDIA_CARD_ASPECT[shape],
            isSelected &&
              "outline-2 outline-offset-2 outline-brand-100 dark:outline-brand-700",
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          {...dragProps}
        >
          {children}

          <div className="opacity-0 transition-opacity duration-200 group-hover/media:opacity-100 group-has-[button[data-state=open]]/media:opacity-100">
            {scrim}
          </div>

          {/* The card itself. Everything drawn above is either the media or an
              overlay control, so this is the only thing that names the card to
              a screen reader or to a script driving the app -- unlabeled it is
              a bare `button` reachable by position and nothing else. */}
          <button
            aria-label={`Open ${file.filename}`}
            className="absolute inset-0 z-0 size-full rounded-2xl outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:[outline-style:solid]"
            onClick={onClick}
            type="button"
          />

          {!hideActionsMenu && (
            <button
              // Same `onClick` as the card: this is the affordance that says the
              // card opens, not a second thing to do. Exposing it would put two
              // identically named controls and two tab stops on one action, so
              // it stays out of the tree and out of the tab order, and the card
              // behind it answers for both.
              aria-hidden
              className={cn(
                "absolute top-3 right-3 z-10 flex size-7 items-center justify-center",
                "text-white opacity-0 drop-shadow-sm transition-opacity duration-200 group-hover/media:opacity-100 group-has-[button[data-state=open]]/media:opacity-100",
              )}
              onClick={onClick}
              tabIndex={-1}
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
                // The press and the release straddle the moment above: a button
                // pressed while nothing was armed still releases over one that
                // now is, and the click belongs to neither.
                if (
                  hoverStartRef.current !== null &&
                  Date.now() - hoverStartRef.current < ARMED_DELAY_MS
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
