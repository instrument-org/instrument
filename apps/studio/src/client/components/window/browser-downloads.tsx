import { FileTypeIcon } from "@/client/components/extend/file-system";
import { TOOLBAR_ICON_BUTTON_CLASSNAME } from "@/client/components/toolbar-control";
import { OpenTargetIcon } from "@/client/components/open-target-icon";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Progress } from "@/client/components/ui/progress";
import { nameOf } from "@/client/components/window/host-path";
import { useCloseOnWindowBlur } from "@/client/hooks/use-close-on-window-blur";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import { useOpenFile } from "@/client/hooks/use-open-file";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Download =
  RPCOutput["browser"]["live"]["downloads"] extends AsyncIterable<(infer D)[]>
    ? D
    : never;

/**
 * The browser's downloads, as a button beside the page's menu that is there
 * only while the list has something on it. While a download runs, a ring
 * around the button fills with how far along the running ones are; a press
 * shows the list, where each file can be opened, shown in its folder,
 * stopped, or taken off the list.
 */
export function BrowserDownloadsButton({
  surfaceRef,
  targetId,
}: {
  /** The page's area, which a download it starts is drawn leaving from. */
  surfaceRef: RefObject<HTMLElement | null>;
  /** The page this button sits over. */
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: downloads = [] } = useQuery(
    rpcClient.browser.live.downloads.experimental_liveOptions(),
  );
  const [buttonScope, bounce] = useAnimate<HTMLButtonElement>();
  const flight = useDownloadFlight({
    buttonRef: buttonScope,
    downloads,
    onArrive: () => {
      void bounce(
        buttonScope.current,
        { scale: [1, 1.3, 0.95, 1] },
        { duration: 0.45, ease: "easeOut" },
      );
    },
    surfaceRef,
    targetId,
  });
  const clear = useMutation(
    rpcClient.browser.downloads.clear.mutationOptions(),
  );
  // A press in the page goes to another web contents and never dismisses the
  // popover on its own.
  useCloseOnWindowBlur(open, () => {
    setOpen(false);
  });

  if (downloads.length === 0) {
    return null;
  }
  const running = downloads.filter(isRunning);
  const hasFinished = running.length < downloads.length;

  return (
    <Popover modal={false} onOpenChange={setOpen} open={open}>
      <ToolbarTooltip label="Downloads">
        <PopoverTrigger asChild>
          <Button
            className={cn(TOOLBAR_ICON_BUTTON_CLASSNAME, "relative")}
            ref={buttonScope}
            size="icon-sm"
            variant="ghost"
          >
            {running.length > 0 && <ProgressRing downloads={running} />}
            <DownloadSimpleIcon
              className={cn("size-4", running.length > 0 && "size-3")}
            />
          </Button>
        </PopoverTrigger>
      </ToolbarTooltip>
      {flight}
      <PopoverContent align="end" className="w-80 p-0" maxHeight="28rem">
        <div className="flex items-center justify-between border-b py-1.5 pr-1.5 pl-3">
          <span className="text-sm font-medium">Downloads</span>
          <Button
            disabled={!hasFinished}
            onClick={() => {
              clear.mutate(undefined);
            }}
            size="sm"
            variant="ghost"
          >
            Clear
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto p-1">
          {downloads.map((download) => (
            <DownloadRow download={download} key={download.id} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// How far along the running downloads are together, drawn around the icon.
// Spins without a fill when none of them said how large it is.
function ProgressRing({ downloads }: { downloads: Download[] }) {
  const sized = downloads.filter((d) => d.totalBytes > 0);
  const total = sized.reduce((sum, d) => sum + d.totalBytes, 0);
  const received = sized.reduce((sum, d) => sum + d.receivedBytes, 0);
  const fraction = total > 0 ? Math.min(received / total, 1) : null;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      aria-hidden
      className={cn(
        "absolute inset-0 m-auto size-5.5 -rotate-90",
        fraction === null && "animate-spin",
      )}
      viewBox="0 0 22 22"
    >
      <circle
        className="stroke-foreground/15"
        cx="11"
        cy="11"
        fill="none"
        r={radius}
        strokeWidth="2"
      />
      <circle
        className="stroke-brand-500 transition-[stroke-dashoffset] duration-200"
        cx="11"
        cy="11"
        fill="none"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (fraction ?? 0.25))}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function DownloadRow({ download }: { download: Download }) {
  const openFile = useOpenFile();
  const cancel = useMutation(
    rpcClient.browser.downloads.cancel.mutationOptions(),
  );
  const remove = useMutation(
    rpcClient.browser.downloads.remove.mutationOptions(),
  );
  const retry = useMutation(
    rpcClient.browser.downloads.retry.mutationOptions(),
  );
  const { path } = download;
  const running = isRunning(download);
  const openable = download.exists && path !== null;
  // A file still being written drags out half of itself.
  const dragProps = useFileDrag(
    openable && !running ? { hostPath: path } : undefined,
  );

  return (
    <li className="group/download flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent">
      <button
        {...dragProps}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-100"
        disabled={!openable}
        onClick={() => {
          if (path) {
            openFile({ hostPath: path });
          }
        }}
        type="button"
      >
        {openable ? (
          <OpenTargetIcon className="size-8" file={{ hostPath: path }} />
        ) : (
          <FileTypeIcon
            className={cn("size-8", !running && "opacity-50")}
            fileName={download.filename}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "truncate text-sm",
              !running && !openable && "text-muted-foreground",
            )}
          >
            {path ? nameOf(path) : download.filename}
          </span>
          {running && download.totalBytes > 0 && (
            <Progress
              className="h-1"
              value={(download.receivedBytes / download.totalBytes) * 100}
            />
          )}
          <span className="truncate text-xs text-muted-foreground">
            {statusLine(download)}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center">
        {(download.state === "canceled" || download.state === "failed") &&
          isWebAddress(download.url) && (
            <ToolbarTooltip label="Try again">
              <Button
                className="size-7"
                onClick={() => {
                  retry.mutate({ id: download.id });
                }}
                size="icon-sm"
                variant="ghost"
              >
                <ArrowClockwiseIcon />
              </Button>
            </ToolbarTooltip>
          )}
        {openable && (
          <ToolbarTooltip label={showInFolderLabel("file")}>
            <Button
              className="size-7"
              onClick={() => {
                void showInFolder(path, { kind: "file" });
              }}
              size="icon-sm"
              variant="ghost"
            >
              <MagnifyingGlassIcon />
            </Button>
          </ToolbarTooltip>
        )}
        <ToolbarTooltip label={running ? "Stop download" : "Remove from list"}>
          <Button
            className={cn(
              "size-7",
              !running &&
                "opacity-0 group-hover/download:opacity-100 focus-visible:opacity-100",
            )}
            onClick={() => {
              if (running) {
                cancel.mutate({ id: download.id });
              } else {
                remove.mutate({ id: download.id });
              }
            }}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </ToolbarTooltip>
      </div>
    </li>
  );
}

/** Whether a download can be asked for again from its address alone. */
function isWebAddress(url: string) {
  return /^https?:/i.test(url);
}

/** How long after a download starts its arrival is still worth drawing. */
const FLIGHT_FRESH_MS = 5000;

/** The downloads whose arrival was drawn, so a second button over the same page draws none. */
const flown = new Set<string>();

/**
 * A new download drawn as its file's icon leaving from where it was pressed
 * in the page, or the page's middle, and dropping into the button in an arc,
 * the way a browser shows one begin. Only over the page it came from, and
 * only once per download.
 */
function useDownloadFlight({
  buttonRef,
  downloads,
  onArrive,
  surfaceRef,
  targetId,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  downloads: Download[];
  onArrive: () => void;
  surfaceRef: RefObject<HTMLElement | null>;
  targetId: string;
}) {
  const isReduced = useReducedMotion();
  const [flight, setFlight] = useState<{
    filename: string;
    from: { x: number; y: number };
    id: string;
    to: { x: number; y: number };
  } | null>(null);
  const arrive = useRef(onArrive);
  useEffect(() => {
    arrive.current = onArrive;
  });

  useEffect(() => {
    const fresh = downloads.find(
      (download) =>
        download.origin?.targetId === targetId &&
        !flown.has(download.id) &&
        Date.now() - download.startedAt < FLIGHT_FRESH_MS,
    );
    if (fresh === undefined) {
      return;
    }
    flown.add(fresh.id);
    const surface = surfaceRef.current?.getBoundingClientRect();
    const button = buttonRef.current?.getBoundingClientRect();
    if (!surface || !button || button.width === 0) {
      return;
    }
    if (isReduced) {
      arrive.current();
      return;
    }
    const { x, y } = fresh.origin ?? {};
    setFlight({
      filename: fresh.filename,
      from:
        x === undefined || y === undefined
          ? {
              x: surface.left + surface.width / 2,
              y: surface.top + surface.height / 2,
            }
          : { x: surface.left + x, y: surface.top + y },
      id: fresh.id,
      to: {
        x: button.left + button.width / 2,
        y: button.top + button.height / 2,
      },
    });
  }, [buttonRef, downloads, isReduced, surfaceRef, targetId]);

  if (flight === null) {
    return null;
  }
  const { from, to } = flight;
  const ICON = 32;
  // The arc comes of the two moves easing apart: the icon rises off the page
  // at once and drifts across late, so it curves into the button rather than
  // sliding to it, and never leaves the window, as a peak above the
  // toolbar's button would.
  return createPortal(
    <motion.div
      animate={{
        opacity: [0, 1, 1, 0.6],
        scale: [0.6, 1.1, 0.9, 0.4],
        x: [from.x - ICON / 2, to.x - ICON / 2],
        y: [from.y - ICON / 2, to.y - ICON / 2],
      }}
      className="pointer-events-none fixed top-0 left-0 z-50 drop-shadow-md"
      key={flight.id}
      onAnimationComplete={() => {
        setFlight(null);
        arrive.current();
      }}
      transition={{
        duration: 0.7,
        opacity: { duration: 0.7, times: [0, 0.1, 0.85, 1] },
        scale: { duration: 0.7, times: [0, 0.3, 0.8, 1] },
        x: { duration: 0.7, ease: [0.55, 0, 0.9, 0.6] },
        y: { duration: 0.7, ease: [0.1, 0.6, 0.35, 1] },
      }}
    >
      <FileTypeIcon className="size-8" fileName={flight.filename} />
    </motion.div>,
    document.body,
  );
}

function isRunning(download: Download) {
  return download.state === "progressing" || download.state === "interrupted";
}

function statusLine(download: Download): string {
  const { receivedBytes, state, totalBytes } = download;
  if (state === "progressing") {
    return totalBytes > 0
      ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
      : formatBytes(receivedBytes);
  }
  if (state === "interrupted") {
    return "Waiting for the connection to come back";
  }
  if (state === "canceled") {
    return "Stopped";
  }
  if (state === "failed") {
    return "Couldn’t finish downloading";
  }
  if (!download.exists) {
    return "Moved or deleted";
  }
  const site = siteOf(download.url);
  const size = formatBytes(totalBytes || receivedBytes);
  return site ? `${size} · ${site}` : size;
}

function siteOf(url: string): null | string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
