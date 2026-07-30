import { cn } from "@/client/lib/utils";
import {
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  SidebarSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";
import { toolbarClassName } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_LEVELS } from "./zoom-levels";

const actionClassName = toolbarClassName({
  className: "size-7",
  pressed: false,
});

const openableClassName =
  "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

/**
 * Find lives behind a popover in every viewer rather than as an always-visible
 * field, so the toolbar stays the same width at every panel size and the
 * narrow artifact panel does not have to drop it.
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
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center gap-1">
          <Input
            className="h-8 min-w-0 flex-1 text-xs"
            onChange={(event) => {
              onQueryChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) {
                  onPreviousMatch();
                } else {
                  onNextMatch();
                }
              }
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Find"
            ref={inputRef}
            value={query}
          />
          <span className="w-14 shrink-0 text-center text-xs text-muted-foreground tabular-nums">
            {query === ""
              ? ""
              : matchCount === 0
                ? "None"
                : `${activeMatch + 1}/${matchCount}`}
          </span>
          <Button
            aria-label="Previous match"
            className={actionClassName}
            disabled={matchCount === 0}
            onClick={onPreviousMatch}
            size="icon-sm"
            variant="ghost"
          >
            <CaretLeftIcon className="size-4" />
          </Button>
          <Button
            aria-label="Next match"
            className={actionClassName}
            disabled={matchCount === 0}
            onClick={onNextMatch}
            size="icon-sm"
            variant="ghost"
          >
            <CaretRightIcon className="size-4" />
          </Button>
          <Button
            aria-label="Close find"
            className={actionClassName}
            onClick={() => {
              onQueryChange("");
              setOpen(false);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
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
 * Declares a container so the controls inside can collapse against the panel's
 * own width. The artifact panel is resizable and the window is zoomable, so a
 * viewport breakpoint would be measuring the wrong thing.
 */
export function ViewerToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="@container/viewer-toolbar flex h-10 shrink-0 items-center gap-1 border-t border-border/60 px-2">
      {children}
    </div>
  );
}

export function ViewerToolbarSeparator() {
  return (
    <Separator
      className="mx-1 h-4 @max-[420px]/viewer-toolbar:hidden"
      orientation="vertical"
    />
  );
}

export function ViewerToolbarSpacer() {
  return <div className="flex-1" />;
}

/**
 * Zoom stepper plus a menu of fixed levels. `onFit` is optional because not
 * every format has a meaningful fit-to-width (a spreadsheet does not).
 */
export function ViewerZoomControl({
  onFit,
  onZoomChange,
  zoom,
}: {
  onFit?: () => void;
  onZoomChange: (zoom: number) => void;
  zoom: number;
}) {
  const step = (direction: -1 | 1) => {
    const next =
      direction === 1
        ? ZOOM_LEVELS.find((level) => level > zoom + 0.001)
        : [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001);
    if (next !== undefined) {
      onZoomChange(next);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(actionClassName, "@max-[520px]/viewer-toolbar:hidden")}
            disabled={zoom <= MIN_ZOOM}
            onClick={() => {
              step(-1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <MinusIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom out</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className={toolbarClassName({
              className: cn("h-7 gap-1 px-1.5 text-xs tabular-nums", openableClassName),
              pressed: false,
            })}
            size="sm"
            variant="ghost"
          >
            {Math.round(zoom * 100)}%
            <CaretDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-28">
          {onFit && (
            <DropdownMenuItem onClick={onFit}>Fit width</DropdownMenuItem>
          )}
          {ZOOM_LEVELS.map((level) => (
            <DropdownMenuItem
              key={level}
              onClick={() => {
                onZoomChange(level);
              }}
            >
              {Math.round(level * 100)}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(actionClassName, "@max-[520px]/viewer-toolbar:hidden")}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => {
              step(1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom in</TooltipContent>
      </Tooltip>
    </div>
  );
}
