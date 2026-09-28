import { type WindowTab } from "@/client/atoms/orchestrator";
import {
  FileSystemFolderGlyph,
  FileTypeIcon,
} from "@/client/components/extend/file-system";
import { useTheme } from "@/client/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useBrowserAgentActivity } from "@/client/hooks/use-browser-agent-activity";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import {
  useTargetAgentActivity,
  useTargetAgentLastAt,
} from "@/client/hooks/use-target-agent-activity";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, Reorder } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { computerName } from "./computer-name";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { SiteIcon } from "./sidebar";
import { thumbnailKey } from "./use-page-thumbnail-housekeeping";

/** A layout change that lands at once, for tiles moved by anything but a drag. */
const STILL = { layout: { duration: 0 } };

/** How long after a page loads, moves, or renames itself its picture is taken. */
const CHANGE_SETTLE_MS = 500;

/**
 * How long after an agent's last command in a page its picture is taken:
 * one command of the agent's arrives as a burst, and the page redraws after.
 */
const AGENT_SETTLE_MS = 1000;

/**
 * What a chat holds, down its right edge: a tile for each thing it has open
 * (the pages its agent browses and the person opened, files, folders), the
 * oldest at the top and the newest at the foot beside New, scrolling when
 * there are many. A page is a picture of itself, taken as it loads and
 * changes and kept, so a chat reopened later, or after a relaunch, shows
 * its pages at once; a file is the picture the app keeps of it; a folder is
 * its mark. Pressing a tile brings the thing up
 * large beside the chat; its × takes it out of the chat; dragging one moves
 * it among the others. New, under the last tile, opens the web or this
 * computer beside the chat.
 */
export function ThreadRail({
  activeId,
  appsBySlug,
  isThreadWorking,
  isViewOpen,
  onAddComputer,
  onAddWeb,
  onClose,
  onReorder,
  onSelect,
  tabs,
  targetOf,
  taskTitles,
  threadTitles,
}: {
  activeId: string | undefined;
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  /** Whether the chat or any task of it is at work: a page's working mark drops the moment none is. */
  isThreadWorking: boolean;
  /** Whether the thing up is shown large, which is when its tile reads as chosen and its page is on screen. */
  isViewOpen: boolean;
  onAddComputer: () => void;
  onAddWeb: () => void;
  onClose: (id: string) => void;
  /** The chat's tabs in a new order, by their strip keys, oldest first. */
  onReorder: (keys: string[]) => void;
  onSelect: (id: string) => void;
  tabs: WindowTab[];
  /** The guest a page tab is drawn by, for taking its picture. */
  targetOf: (tab: Extract<WindowTab, { kind: "page" }>) => BrowserTargetId;
  taskTitles?: Parameters<typeof screenPresentation>[1]["taskTitles"];
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  // Tiles slide only while one is being dragged among them: laid out
  // otherwise, they would slide every time the window around the rail grows,
  // shrinks or moves.
  const [isDragging, setDragging] = useState(false);
  // A tab added lands at the foot, so the list follows it there.
  const listRef = useRef<HTMLDivElement>(null);
  const count = useRef(tabs.length);
  useEffect(() => {
    if (tabs.length > count.current) {
      listRef.current?.scrollTo({
        behavior: "smooth",
        top: listRef.current.scrollHeight,
      });
    }
    count.current = tabs.length;
  }, [tabs.length]);
  return (
    <aside
      aria-label="What this chat has open"
      className="flex h-full w-30 shrink-0 flex-col border-l border-border bg-background select-none"
    >
      <motion.div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3"
        layoutScroll
        ref={listRef}
      >
        <Reorder.Group
          axis="y"
          className="flex flex-col gap-4"
          onReorder={(keys: string[]) => {
            onReorder(keys);
          }}
          values={tabs.map(keyOf)}
        >
          {tabs.map((tab) => (
            <Reorder.Item
              as="div"
              key={tab.id}
              onDragEnd={() => {
                setDragging(false);
              }}
              onDragStart={() => {
                setDragging(true);
              }}
              transition={isDragging ? undefined : STILL}
              value={keyOf(tab)}
            >
              <RailTile
                appsBySlug={appsBySlug}
                isChosen={isViewOpen && tab.id === activeId}
                isOnScreen={isViewOpen && tab.id === activeId}
                isThreadWorking={isThreadWorking}
                onClose={() => {
                  onClose(tab.id);
                }}
                onSelect={() => {
                  onSelect(tab.id);
                }}
                tab={tab}
                targetOf={targetOf}
                taskTitles={taskTitles}
                threadTitles={threadTitles}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {/* Right under the last tile, the way a list's add row follows it. */}
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Open beside the chat"
                className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                type="button"
              >
                <PlusIcon className="size-4" />
                New
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-2">
              <div className="grid grid-cols-2 gap-1">
                <AddTile
                  icon={<GlobeIcon />}
                  label="Browser"
                  onSelect={onAddWeb}
                />
                <AddTile
                  icon={<DesktopIcon />}
                  label={computerName()}
                  onSelect={onAddComputer}
                />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.div>
    </aside>
  );
}

function AddTile({
  icon,
  label,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className="group/tile flex-col gap-1.5 rounded-xl p-1.5 text-xs font-medium"
      onSelect={onSelect}
    >
      <span className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-card shadow-xs ring-1 ring-border/70 group-data-highlighted/tile:ring-border [&_svg]:size-7 [&_svg]:text-muted-foreground">
        {icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </DropdownMenuItem>
  );
}

/**
 * A picture whole inside its tile, the room it leaves at its sides filled
 * with a blurred, dimmed copy of itself rather than bars, so a dark page
 * does not sit between two bands of the tile's own color.
 */
function FittedPicture({
  onError,
  src,
}: {
  onError?: () => void;
  src: string;
}) {
  return (
    <span className="relative size-full overflow-hidden">
      <img
        alt=""
        aria-hidden
        className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-md"
        draggable={false}
        src={src}
      />
      <img
        alt=""
        className="relative size-full object-contain"
        draggable={false}
        onError={onError}
        src={src}
      />
    </span>
  );
}

function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/** A tab as the strip orders it. */
function keyOf(tab: WindowTab): string {
  return tab.stripKey ?? tab.id;
}

/**
 * A page as its last picture, or, until it has one, its site's mark. The
 * picture is taken each time a page off screen loads, moves, renames
 * itself, or has an agent's command, since the agent browses in tabs the
 * person is not looking at, and once more as a page leaves the screen. The
 * page on screen shows its mark instead and takes none: it is drawn large
 * beside the chat already, and picturing it as it is used would cost for
 * nothing.
 */
function PagePicture({
  isOnScreen,
  tab,
  targetId,
}: {
  isOnScreen: boolean;
  tab: Extract<WindowTab, { kind: "page" }>;
  targetId: BrowserTargetId;
}) {
  const queryClient = useQueryClient();
  const picture = useQuery({
    queryFn: () => rpcClient.browser.thumbnails.get.call({ key: tab.id }),
    queryKey: thumbnailKey(tab.id),
    staleTime: Infinity,
  });
  const isAttached = useBrowserTargets().has(targetId);
  // Each request numbered, so a picture that finishes after a newer one was
  // asked for never replaces it.
  const requested = useRef(0);
  const capture = () => {
    const webview = getWebviewElement(targetId);
    let webContentsId: number | undefined;
    try {
      webContentsId = webview?.getWebContentsId();
    } catch {
      // Not attached yet: there is nothing drawn to take.
      return;
    }
    if (webContentsId === undefined) {
      return;
    }
    requested.current += 1;
    const mine = requested.current;
    void rpcClient.browser.thumbnails.capture
      .call({ key: tab.id, webContentsId })
      .then((result) => {
        if (result.url && mine === requested.current) {
          queryClient.setQueryData(thumbnailKey(tab.id), result);
        }
      })
      .catch(() => {
        // A missed picture keeps the last one; the next visit takes another.
      });
  };
  // A picture shortly after a page off screen loads, moves, or renames
  // itself. A guest off screen that draws nothing leaves the last picture in
  // place.
  useEffect(() => {
    const webview = isOnScreen ? null : getWebviewElement(targetId);
    if (!webview) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(capture, CHANGE_SETTLE_MS);
    };
    const events = [
      "did-stop-loading",
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
    ] as const;
    for (const event of events) {
      webview.addEventListener(event, soon);
    }
    return () => {
      for (const event of events) {
        webview.removeEventListener(event, soon);
      }
      clearTimeout(pending);
    };
    // Re-armed when the page leaves or comes on screen and when its guest
    // attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnScreen, isAttached, targetId]);
  // A picture shortly after an agent works in a page off screen, since
  // clicking, typing, and scripts change a page without moving it.
  const agentAt = useTargetAgentLastAt(targetId);
  useEffect(() => {
    if (isOnScreen || agentAt === undefined) {
      return;
    }
    const pending = setTimeout(capture, AGENT_SETTLE_MS);
    return () => {
      clearTimeout(pending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAt, isOnScreen]);
  // Leaving the screen: one more, of the page as it was last seen. Not when
  // the tile goes, which is the tab closing.
  const wasOnScreen = useRef(isOnScreen);
  useEffect(() => {
    if (wasOnScreen.current && !isOnScreen) {
      capture();
    }
    wasOnScreen.current = isOnScreen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnScreen]);

  if (picture.data?.url && !isOnScreen) {
    return <FittedPicture src={picture.data.url} />;
  }
  return (
    <span className="[&_img]:size-6 [&_svg]:size-6">
      <SiteIcon favicon={tab.favicon} url={tab.url ?? tab.openedUrl ?? ""} />
    </span>
  );
}

/**
 * Whether an agent is at work in a page, the way the tab strip asks it: a
 * task's own browser by the task, a page of the chat's handed to a task by
 * its guest.
 */
function PageWorking({
  children,
  isThreadWorking,
  tab,
  targetId,
}: {
  children: (isWorking: boolean) => ReactNode;
  isThreadWorking: boolean;
  tab: Extract<WindowTab, { kind: "page" }>;
  targetId: BrowserTargetId;
}) {
  return tab.taskId ? (
    <TaskWorking taskId={tab.taskId}>{children}</TaskWorking>
  ) : (
    <TargetWorking isThreadWorking={isThreadWorking} targetId={targetId}>
      {children}
    </TargetWorking>
  );
}

function RailTile({
  appsBySlug,
  isChosen,
  isOnScreen,
  isThreadWorking,
  onClose,
  onSelect,
  tab,
  targetOf,
  taskTitles,
  threadTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  isChosen: boolean;
  isOnScreen: boolean;
  isThreadWorking: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: WindowTab;
  targetOf: (tab: Extract<WindowTab, { kind: "page" }>) => BrowserTargetId;
  taskTitles: Parameters<typeof screenPresentation>[1]["taskTitles"];
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  const title =
    tab.kind === "page"
      ? tab.title || hostOf(tab.url ?? tab.openedUrl ?? "")
      : screenPresentation(tab.href, { appsBySlug, taskTitles, threadTitles })
          .title;
  const tile = (isWorking: boolean) => (
    <div className="group/tile relative flex flex-col gap-1.5">
      <button
        aria-label={title}
        className="flex flex-col gap-1.5 text-left outline-none"
        // A middle click closes it, as it does a browser's tab.
        onAuxClick={(event) => {
          if (event.button === 1) {
            onClose();
          }
        }}
        onClick={onSelect}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
        type="button"
      >
        <span
          className={cn(
            "relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg bg-card shadow-xs ring-1 transition",
            isChosen
              ? "ring-2 ring-foreground/70"
              : "ring-border/70 group-hover/tile:ring-border",
          )}
        >
          {tab.kind === "page" ? (
            <PagePicture
              isOnScreen={isOnScreen}
              tab={tab}
              targetId={targetOf(tab)}
            />
          ) : (
            <ScreenPicture
              appsBySlug={appsBySlug}
              href={tab.href}
              threadTitles={threadTitles}
            />
          )}
        </span>
        {/* Every tile names what it is by its mark as well, which its
            picture hides: a page's site, a file's type, a folder, an app. */}
        <span className="flex min-w-0 items-center gap-1 px-0.5 text-[11px] leading-4 text-muted-foreground group-hover/tile:text-foreground">
          <span className="grid size-3 shrink-0 place-items-center [&_img]:size-3 [&_svg]:size-3">
            {tab.kind === "page" ? (
              <SiteIcon
                favicon={tab.favicon}
                url={tab.url ?? tab.openedUrl ?? ""}
              />
            ) : (
              <ScreenMark
                appsBySlug={appsBySlug}
                href={tab.href}
                threadTitles={threadTitles}
              />
            )}
          </span>
          <span className={cn("truncate", isWorking && "brand-shiny-text")}>
            {title}
          </span>
        </span>
      </button>
      <button
        aria-label={`Close ${title}`}
        className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-background/90 text-muted-foreground opacity-0 shadow-xs ring-1 ring-border transition group-hover/tile:opacity-100 hover:text-foreground focus-visible:opacity-100"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3" weight="bold" />
      </button>
    </div>
  );
  return tab.kind === "page" ? (
    <PageWorking
      isThreadWorking={isThreadWorking}
      tab={tab}
      targetId={targetOf(tab)}
    >
      {tile}
    </PageWorking>
  ) : (
    tile(false)
  );
}

/** A screen's small mark beside its name: a file's type, a folder, or the screen's own icon. */
function ScreenMark({
  appsBySlug,
  href,
  threadTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  href: string;
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  const location = screenLocation(href, { appsBySlug, threadTitles });
  if (location.kind === "file") {
    return <FileTypeIcon className="size-3" fileName={location.name} />;
  }
  if (location.kind === "folder") {
    return <FileSystemFolderGlyph className="h-2.5 w-auto" />;
  }
  return screenPresentation(href, { appsBySlug, threadTitles }).icon;
}

/** A screen as what it shows: a file as the picture the app keeps of it, a folder as its mark, anything else as its own mark. */
function ScreenPicture({
  appsBySlug,
  href,
  threadTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  href: string;
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  const { resolvedTheme } = useTheme();
  const location = screenLocation(href, { appsBySlug, threadTitles });
  const [failed, setFailed] = useState<string>();
  // Watched while the tile is up, so a file written to, by the agent or
  // anyone, is pictured again as it now is rather than as it first was.
  const { data: info } = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input: location.kind === "file" ? { path: location.path } : skipToken,
    }),
  );
  if (location.kind === "file") {
    const picture = getComputerThumbnailUrl({
      hostPath: location.path,
      size: 512,
      theme: resolvedTheme,
      ...(info ? { version: info.modifiedAt } : {}),
    });
    // A picture that failed is tried again once the file changes.
    if (picture && failed !== picture) {
      return (
        <FittedPicture
          onError={() => {
            setFailed(picture);
          }}
          src={picture}
        />
      );
    }
    return <FileTypeIcon className="size-8" fileName={location.name} />;
  }
  if (location.kind === "folder") {
    return <FileSystemFolderGlyph className="h-7 w-auto" />;
  }
  return (
    <span className="text-muted-foreground [&_img]:size-6 [&_svg]:size-6">
      {screenPresentation(href, { appsBySlug, threadTitles }).icon}
    </span>
  );
}

/**
 * A page of the chat's handed to a task: worked in while an agent's commands
 * keep arriving, and never once nothing in the chat is at work, so the mark
 * does not outlast the work by the quiet it waits out.
 */
function TargetWorking({
  children,
  isThreadWorking,
  targetId,
}: {
  children: (isWorking: boolean) => ReactNode;
  isThreadWorking: boolean;
  targetId: BrowserTargetId;
}) {
  const isDriven = useTargetAgentActivity(targetId);
  return children(isThreadWorking && isDriven);
}

function TaskWorking({
  children,
  taskId,
}: {
  children: (isWorking: boolean) => ReactNode;
  taskId: TaskId;
}) {
  return children(useBrowserAgentActivity(taskId));
}
