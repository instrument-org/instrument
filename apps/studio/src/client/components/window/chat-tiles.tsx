import { type WindowTab } from "@/client/atoms/window";
import { PageFavicon } from "@/client/components/favicon";
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
import { getGuest } from "@/client/lib/browser-pool";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, Reorder } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { computerName } from "./computer-name";
import { useComputerVolumes } from "./computer-volumes";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { thumbnailKey } from "./use-page-thumbnail-housekeeping";

/** How much of the row a page leaves in view on its far side: about a tile, so the reader keeps their place. */
const PAGE_KEEP = 96;

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
 * How long the page on screen keeps showing its picture after a newer one
 * arrives, so browsing around swaps the tile once, after the person pauses,
 * rather than at every step.
 */
const ON_SCREEN_SETTLE_MS = 3000;

/**
 * What a chat holds, in a row over its composer: a tile for each thing it
 * has open (the pages its agent browses and the person opened, files,
 * folders), the oldest at the left and the newest at the right beside New,
 * scrolling sideways when there are many. A page is a picture of itself,
 * taken as it loads and changes and kept, so a chat reopened later, or after
 * a relaunch, shows its pages at once; a file is the picture the app keeps
 * of it; a folder is its mark. Pressing a tile brings the thing up large;
 * the tile of the thing up is ringed, and with nothing up none is. Its ×
 * takes it out of the chat; dragging one moves it among the others. New,
 * after the last tile, opens the web or this computer beside the chat.
 */
export function ChatTiles({
  appsBySlug,
  chatTitles,
  chosenId,
  isChatWorking,
  onAddComputer,
  onAddWeb,
  onClose,
  onReorder,
  onSelect,
  tabs,
  targetOf,
  taskTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  chatTitles: Parameters<typeof screenPresentation>[1]["chatTitles"];
  /** The tab shown large, whose tile reads as chosen and whose page is on screen; none while nothing is. */
  chosenId: string | undefined;
  /** Whether the chat or any task of it is at work: a page's working mark drops the moment none is. */
  isChatWorking: boolean;
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
}) {
  // Tiles slide only while one is being dragged among them: laid out
  // otherwise, they would slide every time the column around them grows,
  // shrinks or moves.
  const [isDragging, setDragging] = useState(false);
  // A tab added lands at the right end, so the row follows it there.
  const listRef = useRef<HTMLDivElement>(null);
  const count = useRef(tabs.length);
  useEffect(() => {
    if (tabs.length > count.current) {
      listRef.current?.scrollTo({
        behavior: "smooth",
        left: listRef.current.scrollWidth,
      });
    }
    count.current = tabs.length;
  }, [tabs.length]);
  // Whether the row runs past either end, for the arrows that page it there.
  const [ends, setEnds] = useState({ left: false, right: false });
  const readEnds = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const next = rowEnds(list);
    setEnds((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    );
  };
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const update = () => {
      const next = rowEnds(list);
      setEnds((current) =>
        current.left === next.left && current.right === next.right
          ? current
          : next,
      );
    };
    update();
    // The row itself as the column around it resizes, and its tiles as
    // they come and go.
    const observer = new ResizeObserver(update);
    observer.observe(list);
    if (list.firstElementChild) {
      observer.observe(list.firstElementChild);
    }
    return () => {
      observer.disconnect();
    };
  }, [tabs.length]);
  /** One row's width along, less a tile, so the last tile in view is still in view after. */
  const page = (direction: -1 | 1) => {
    const list = listRef.current;
    list?.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(list.clientWidth - PAGE_KEEP, PAGE_KEEP),
    });
  };
  // The chosen tile is brought into the row's view, so the ring is never
  // scrolled out of sight. Offsets are layout px, which is what scrollLeft
  // is in under the window's zoom.
  useEffect(() => {
    const list = listRef.current;
    if (chosenId === undefined || !list) {
      return;
    }
    const tile = [...list.querySelectorAll<HTMLElement>("[data-tile-id]")].find(
      (element) => element.dataset.tileId === chosenId,
    );
    if (!tile) {
      return;
    }
    const left = tile.offsetLeft;
    const right = left + tile.offsetWidth;
    if (left < list.scrollLeft) {
      list.scrollTo({ behavior: "smooth", left });
    } else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ behavior: "smooth", left: right - list.clientWidth });
    }
  }, [chosenId]);
  return (
    <section
      aria-label="What this chat has open"
      className="relative mb-2 select-none"
    >
      <motion.div
        className="relative flex [scrollbar-width:none] items-start gap-2 overflow-x-auto p-0.5"
        layoutScroll
        onScroll={readEnds}
        // A wheel that only turns up and down scrolls the row sideways.
        onWheel={(event) => {
          const list = event.currentTarget;
          if (
            list.scrollWidth > list.clientWidth &&
            Math.abs(event.deltaY) > Math.abs(event.deltaX)
          ) {
            list.scrollLeft += event.deltaY;
          }
        }}
        ref={listRef}
      >
        <Reorder.Group
          as="div"
          axis="x"
          className="flex shrink-0 gap-2"
          onReorder={(keys: string[]) => {
            onReorder(keys);
          }}
          values={tabs.map(keyOf)}
        >
          {tabs.map((tab) => (
            <Reorder.Item
              as="div"
              className="w-24 shrink-0"
              data-tile-id={tab.id}
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
              <ChatTile
                appsBySlug={appsBySlug}
                chatTitles={chatTitles}
                isChatWorking={isChatWorking}
                isChosen={tab.id === chosenId}
                onClose={() => {
                  onClose(tab.id);
                }}
                onSelect={() => {
                  onSelect(tab.id);
                }}
                tab={tab}
                targetOf={targetOf}
                taskTitles={taskTitles}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {/* Right after the last tile, the way a strip's add button follows its tabs. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Open beside the chat"
              className="flex h-18 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              title="New"
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
      </motion.div>
      {ends.left && (
        <RowEnd
          onPress={() => {
            page(-1);
          }}
          side="left"
        />
      )}
      {ends.right && (
        <RowEnd
          onPress={() => {
            page(1);
          }}
          side="right"
        />
      )}
    </section>
  );
}

/** Whether a row scrolled sideways has more past its left and its right end. */
function rowEnds(list: HTMLElement) {
  return {
    left: list.scrollLeft > 1,
    right: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
  };
}

/**
 * An end of the row with more past it: the row fades there under a round
 * arrow that pages it one row's width that way. It stands over the fade and
 * off the tiles, so it never takes a press meant for one.
 */
function RowEnd({
  onPress,
  side,
}: {
  onPress: () => void;
  side: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-16 items-start pt-6",
        side === "left"
          ? "left-0 justify-start bg-linear-to-r from-background via-background/80 to-transparent pl-1"
          : "right-0 justify-end bg-linear-to-l from-background via-background/80 to-transparent pr-1",
      )}
    >
      <button
        aria-label={side === "left" ? "Show earlier" : "Show more"}
        className="pointer-events-auto grid size-7 place-items-center rounded-full bg-background text-foreground shadow-md ring-1 ring-border hover:bg-accent"
        onClick={onPress}
        type="button"
      >
        {side === "left" ? (
          <CaretLeftIcon className="size-3.5" />
        ) : (
          <CaretRightIcon className="size-3.5" />
        )}
      </button>
    </div>
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
 * A picture at its tile's full width, hung from the top and cut off at the
 * tile's foot: the head of a page or a document is what says what it is, so
 * it is kept whole across, never cropped at the sides. A picture wider than
 * the tile's shape leaves the card's ground under it. The tile's mark rides
 * its lower corner; a tile with no picture shows its mark large instead.
 */
function FittedPicture({
  mark,
  onError,
  src,
}: {
  /** What the tile is, worn on the picture's corner, which the picture alone may not say. */
  mark: ReactNode;
  onError?: () => void;
  src: string;
}) {
  return (
    <>
      <img
        alt=""
        className="absolute inset-x-0 top-0 h-auto w-full"
        draggable={false}
        onError={onError}
        src={src}
      />
      <span className="pointer-events-none absolute bottom-1 left-1 grid size-4 place-items-center rounded-sm bg-background/85 [&_img]:size-3 [&_svg]:size-3">
        {mark}
      </span>
    </>
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
 * picture is taken each time the page loads, moves, renames itself, or has
 * an agent's command, since the agent browses in tabs the person is not
 * looking at. The page on screen shows a newer picture only once no newer
 * one has come for a few seconds, so the tile follows the page without
 * flickering at every step; its pictures are taken while it is drawn, which
 * is when a guest has something to take.
 */
function PagePicture({
  isOnScreen,
  mark,
  tab,
  targetId,
}: {
  isOnScreen: boolean;
  mark: ReactNode;
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
    // A guest not ready yet has nothing drawn to take.
    const webContentsId = getGuest(targetId)?.webContentsId;
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
    const guest = getGuest(targetId);
    if (!guest) {
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
    const stops = events.map((event) => guest.on(event, soon));
    return () => {
      for (const stop of stops) {
        stop();
      }
      clearTimeout(pending);
    };
    // Re-armed when its guest attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAttached, targetId]);
  // A picture shortly after an agent works in a page off screen, since
  // clicking, typing, and scripts change a page without moving it.
  const agentAt = useTargetAgentLastAt(targetId);
  useEffect(() => {
    if (agentAt === undefined) {
      return;
    }
    const pending = setTimeout(capture, AGENT_SETTLE_MS);
    return () => {
      clearTimeout(pending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAt]);
  // The picture shown while the page is up: the one it came up with, then
  // the newest once no newer one has come for a while.
  const [heldUrl, setHeldUrl] = useState<string>();
  const latestUrl = picture.data?.url ?? undefined;
  useEffect(() => {
    if (!isOnScreen) {
      setHeldUrl(undefined);
      return;
    }
    if (latestUrl === undefined) {
      return;
    }
    setHeldUrl((held) => held ?? latestUrl);
    const pending = setTimeout(() => {
      setHeldUrl(latestUrl);
    }, ON_SCREEN_SETTLE_MS);
    return () => {
      clearTimeout(pending);
    };
  }, [isOnScreen, latestUrl]);
  const shownUrl = isOnScreen ? (heldUrl ?? latestUrl) : latestUrl;

  if (shownUrl) {
    return <FittedPicture mark={mark} src={shownUrl} />;
  }
  return (
    <span className="[&_img]:size-6 [&_svg]:size-6">
      <PageFavicon favicon={tab.favicon} url={tab.url ?? tab.openedUrl ?? ""} />
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
  isChatWorking,
  tab,
  targetId,
}: {
  children: (isWorking: boolean) => ReactNode;
  isChatWorking: boolean;
  tab: Extract<WindowTab, { kind: "page" }>;
  targetId: BrowserTargetId;
}) {
  return tab.taskId ? (
    <TaskWorking taskId={tab.taskId}>{children}</TaskWorking>
  ) : (
    <TargetWorking isChatWorking={isChatWorking} targetId={targetId}>
      {children}
    </TargetWorking>
  );
}

function ChatTile({
  appsBySlug,
  chatTitles,
  isChatWorking,
  isChosen,
  onClose,
  onSelect,
  tab,
  targetOf,
  taskTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  chatTitles: Parameters<typeof screenPresentation>[1]["chatTitles"];
  isChatWorking: boolean;
  /** Whether its thing is the one shown large, which is also when its page is on screen. */
  isChosen: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: WindowTab;
  targetOf: (tab: Extract<WindowTab, { kind: "page" }>) => BrowserTargetId;
  taskTitles: Parameters<typeof screenPresentation>[1]["taskTitles"];
}) {
  const volumes = useComputerVolumes();
  const title =
    tab.kind === "page"
      ? tab.title || hostOf(tab.url ?? tab.openedUrl ?? "")
      : screenPresentation(tab.href, {
          appsBySlug,
          chatTitles,
          taskTitles,
          ...(volumes ? { volumes } : {}),
        }).title;
  // What the tile is by its mark, on its picture's corner: a page's site, a
  // file's type, a folder, an app.
  const mark =
    tab.kind === "page" ? (
      <PageFavicon favicon={tab.favicon} url={tab.url ?? tab.openedUrl ?? ""} />
    ) : (
      <ScreenMark
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        href={tab.href}
      />
    );
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
        title={title}
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
              isOnScreen={isChosen}
              mark={mark}
              tab={tab}
              targetId={targetOf(tab)}
            />
          ) : (
            <ScreenPicture
              appsBySlug={appsBySlug}
              chatTitles={chatTitles}
              href={tab.href}
              mark={mark}
            />
          )}
        </span>
        {/* The name alone, at the tile's whole width: the mark is on the
            picture, or is the picture when there is none. */}
        <span className="flex min-w-0 px-0.5 text-[11px] leading-4 text-muted-foreground group-hover/tile:text-foreground">
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
      isChatWorking={isChatWorking}
      tab={tab}
      targetId={targetOf(tab)}
    >
      {tile}
    </PageWorking>
  ) : (
    tile(false)
  );
}

/** A screen's small mark on its picture: a file's type, a folder, or the screen's own icon. */
function ScreenMark({
  appsBySlug,
  chatTitles,
  href,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  chatTitles: Parameters<typeof screenPresentation>[1]["chatTitles"];
  href: string;
}) {
  const location = screenLocation(href, { appsBySlug, chatTitles });
  if (location.kind === "file") {
    return <FileTypeIcon className="size-3" fileName={location.name} />;
  }
  if (location.kind === "folder") {
    return <FileSystemFolderGlyph className="h-2.5 w-auto" />;
  }
  return screenPresentation(href, { appsBySlug, chatTitles }).icon;
}

/** A screen as what it shows: a file as the picture the app keeps of it, a folder as its mark, anything else as its own mark. */
function ScreenPicture({
  appsBySlug,
  chatTitles,
  href,
  mark,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  chatTitles: Parameters<typeof screenPresentation>[1]["chatTitles"];
  href: string;
  mark: ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const location = screenLocation(href, { appsBySlug, chatTitles });
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
          mark={mark}
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
      {screenPresentation(href, { appsBySlug, chatTitles }).icon}
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
  isChatWorking,
  targetId,
}: {
  children: (isWorking: boolean) => ReactNode;
  isChatWorking: boolean;
  targetId: BrowserTargetId;
}) {
  const isDriven = useTargetAgentActivity(targetId);
  return children(isChatWorking && isDriven);
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
