import { cn } from "@/client/lib/utils";
import { MAX_ZOOM, MIN_ZOOM } from "@/client/lib/zoom-levels";
import { steppedZoom } from "@/shared/zoom";
import {
  CaretLeftIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FindRow } from "../find-row";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ZoomLevelMenu, ZoomStepperControl } from "../zoom-controls";

const actionClassName = toolbarClassName({
  className: "size-7",
  pressed: false,
});

const openableClassName =
  "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

/**
 * Find lives behind a popover in every viewer rather than as the always-visible
 * bar the browser panel uses, so the toolbar stays the same width at every
 * panel size and the narrow artifact panel does not have to drop it. What is
 * inside the popover is the same {@link FindRow} the browser bar is built from.
 */
export function ViewerFindControl({
  activeMatch,
  matchCount,
  onNextMatch,
  onPreviousMatch,
  onQueryChange,
  query,
}: {
  activeMatch: number;
  matchCount: number;
  onNextMatch: () => void;
  onPreviousMatch: () => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              className={toolbarClassName({
                className: cn("size-7", openableClassName),
                pressed: false,
              })}
              size="icon-sm"
              variant="ghost"
            >
              <MagnifyingGlassIcon className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Find in document</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-1.5">
        <FindRow
          activeMatch={activeMatch + 1}
          inputRef={inputRef}
          matchCount={matchCount}
          onClose={() => {
            onQueryChange("");
            setOpen(false);
          }}
          onNextMatch={onNextMatch}
          onPreviousMatch={onPreviousMatch}
          onQueryChange={onQueryChange}
          placeholder="Find in document"
          query={query}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Page or slide navigation. The number is an input rather than a label so a
 * jump to page 200 does not mean 200 clicks; it stays a controlled string
 * while focused so a partially typed number is not clamped mid-keystroke.
 */
export function ViewerPageControl({
  count,
  label = "page",
  onPageChange,
  page,
}: {
  count: number;
  label?: string;
  onPageChange: (page: number) => void;
  page: number;
}) {
  const [draft, setDraft] = useState<null | string>(null);

  const commit = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(Math.min(Math.max(parsed, 1), count));
    }
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(actionClassName, "@max-[360px]/viewer-toolbar:hidden")}
            disabled={page <= 1}
            onClick={() => {
              onPageChange(page - 1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <CaretLeftIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous {label}</TooltipContent>
      </Tooltip>
      <Input
        aria-label={`Current ${label}`}
        className="h-7 w-11 px-1 text-center text-xs tabular-nums"
        inputMode="numeric"
        onBlur={(event) => {
          commit(event.target.value);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        value={draft ?? String(page)}
      />
      <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        / {count}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(actionClassName, "@max-[360px]/viewer-toolbar:hidden")}
            disabled={page >= count}
            onClick={() => {
              onPageChange(page + 1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <CaretRightIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next {label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ViewerRailToggle({
  onToggle,
  open,
}: {
  onToggle: () => void;
  open: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={toolbarClassName({ className: "size-7", pressed: open })}
          onClick={onToggle}
          size="icon-sm"
          variant="ghost"
        >
          <SidebarSimpleIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {open ? "Hide thumbnails" : "Show thumbnails"}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The row of document controls beneath the file viewer's own header. Sized in
 * the same idiom as that header so the two read as one piece of chrome.
 *
 * Groups are spaced apart rather than ruled apart: the zoom stepper is a single
 * bounded control and the rest are ghost buttons, so gaps alone carry the
 * grouping without stacking a second set of vertical lines onto it.
 *
 * Declares a container so the controls inside can collapse against the panel's
 * own width. The artifact panel is resizable and the window is zoomable, so a
 * viewport breakpoint would be measuring the wrong thing.
 */
export function ViewerToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="@container/viewer-toolbar flex h-10 shrink-0 items-center gap-3 border-t border-border/60 px-2">
      {children}
    </div>
  );
}

export function ViewerToolbarSpacer() {
  return <div className="flex-1" />;
}

/**
 * The app's zoom stepper, with its readout opened up into a menu of fixed
 * levels. `onFit` is optional because not every format has a meaningful
 * fit-to-width (a spreadsheet does not).
 *
 * `min`/`max` default to the range the level menu offers; a format whose engine
 * clamps to its own range passes that instead, so the stepper stops where the
 * document actually stops.
 *
 * `isFit` marks fit-width as the current selection. Fit is a mode that survives
 * container resizes, not a one-off jump to a level, so the menu has to show
 * which of the two the document is on; the readout stays a percentage because
 * that is still what the stepper would move from.
 */
export function ViewerZoomControl({
  isFit = false,
  max = MAX_ZOOM,
  min = MIN_ZOOM,
  onFit,
  onZoomChange,
  zoom,
}: {
  isFit?: boolean;
  max?: number;
  min?: number;
  onFit?: () => void;
  onZoomChange: (zoom: number) => void;
  zoom: number;
}) {
  return (
    <ZoomStepperControl
      canZoomIn={zoom < max}
      canZoomOut={zoom > min}
      onZoomIn={() => {
        onZoomChange(steppedZoom({ direction: "in", factor: zoom, max, min }));
      }}
      onZoomOut={() => {
        onZoomChange(steppedZoom({ direction: "out", factor: zoom, max, min }));
      }}
      readout={
        <ZoomLevelMenu
          compact
          isFit={isFit}
          max={max}
          min={min}
          onFit={onFit}
          onSelect={onZoomChange}
          zoom={zoom}
        />
      }
      size="sm"
    />
  );
}
