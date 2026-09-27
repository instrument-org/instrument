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
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { getComputerThumbnailUrl } from "@/client/lib/computer-file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { computerName } from "./computer-name";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { SiteIcon } from "./sidebar";
import { thumbnailKey } from "./use-page-thumbnail-housekeeping";

/** How long a page on screen is left to settle before its picture is taken. */
const SETTLE_MS = 1500;

/**
 * What a chat holds, down its right edge: a tile for each thing it has open
 * (the pages its agent browses and the person opened, files, folders), the
 * newest at the top, scrolling when there are many. A page is a picture of
 * itself, taken while it is on screen and kept, so a chat reopened later, or
 * after a relaunch, shows its pages at once; a file is the picture the app
 * keeps of it; a folder is its mark. Pressing a tile brings the thing up
 * large beside the chat; its × takes it out of the chat. The + at the top
 * opens the web or this computer beside the chat.
 */
export function ThreadRail({
  activeId,
  appsBySlug,
  isViewOpen,
  onAddComputer,
  onAddWeb,
  onClose,
  onSelect,
  tabs,
  targetOf,
  threadTitles,
}: {
  activeId: string | undefined;
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  /** Whether the thing up is shown large, which is when its tile reads as chosen and its page is on screen. */
  isViewOpen: boolean;
  onAddComputer: () => void;
  onAddWeb: () => void;
  onClose: (id: string) => void;
  onSelect: (id: string) => void;
  tabs: WindowTab[];
  /** The guest a page tab is drawn by, for taking its picture. */
  targetOf: (tab: Extract<WindowTab, { kind: "page" }>) => BrowserTargetId;
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  const newestFirst = tabs.toReversed();
  return (
    <aside
      aria-label="What this chat has open"
      className="flex h-full w-30 shrink-0 flex-col border-l border-border bg-background"
    >
      <div className="flex h-10 shrink-0 items-center justify-end px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Open beside the chat"
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              type="button"
            >
              <PlusIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-2">
            <div className="grid grid-cols-2 gap-1">
              <AddTile icon={<GlobeIcon />} label="Web" onSelect={onAddWeb} />
              <AddTile
                icon={<DesktopIcon />}
                label={computerName()}
                onSelect={onAddComputer}
              />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-3">
        {newestFirst.map((tab) => (
          <RailTile
            appsBySlug={appsBySlug}
            isChosen={isViewOpen && tab.id === activeId}
            isOnScreen={isViewOpen && tab.id === activeId}
            key={tab.id}
            onClose={() => {
              onClose(tab.id);
            }}
            onSelect={() => {
              onSelect(tab.id);
            }}
            tab={tab}
            targetOf={targetOf}
            threadTitles={threadTitles}
          />
        ))}
      </div>
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

function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

/**
 * A page as its last picture, or, until it has one, its site's mark. The
 * picture is taken while the page is on screen: once it has settled, again
 * when it moves somewhere else, and once more as it leaves the screen.
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
  // While on screen: a picture each time the page finishes loading, and one
  // once it has settled if it was already loaded when it came up.
  useEffect(() => {
    const webview = isOnScreen ? getWebviewElement(targetId) : null;
    if (!webview) {
      return;
    }
    const onLoaded = () => {
      capture();
    };
    webview.addEventListener("did-stop-loading", onLoaded);
    let settled: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!webview.isLoading()) {
        settled = setTimeout(capture, SETTLE_MS);
      }
    } catch {
      // Not attached yet: its first load will say when it is ready.
    }
    return () => {
      webview.removeEventListener("did-stop-loading", onLoaded);
      clearTimeout(settled);
    };
    // Re-armed when the page comes on screen and when its guest attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnScreen, isAttached, targetId]);
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

  if (picture.data?.url) {
    return (
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        src={picture.data.url}
      />
    );
  }
  return (
    <span className="[&_img]:size-6 [&_svg]:size-6">
      <SiteIcon favicon={tab.favicon} url={tab.url ?? tab.openedUrl ?? ""} />
    </span>
  );
}

function RailTile({
  appsBySlug,
  isChosen,
  isOnScreen,
  onClose,
  onSelect,
  tab,
  targetOf,
  threadTitles,
}: {
  appsBySlug: Parameters<typeof screenPresentation>[1]["appsBySlug"];
  isChosen: boolean;
  isOnScreen: boolean;
  onClose: () => void;
  onSelect: () => void;
  tab: WindowTab;
  targetOf: (tab: Extract<WindowTab, { kind: "page" }>) => BrowserTargetId;
  threadTitles: Parameters<typeof screenPresentation>[1]["threadTitles"];
}) {
  const title =
    tab.kind === "page"
      ? tab.title || hostOf(tab.url ?? tab.openedUrl ?? "")
      : screenPresentation(tab.href, { appsBySlug, threadTitles }).title;
  return (
    <div className="group/tile relative flex flex-col gap-1.5">
      <button
        aria-label={title}
        className="flex flex-col gap-1.5 text-left outline-none"
        onClick={onSelect}
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
        <span className="truncate px-0.5 text-[11px] leading-4 text-muted-foreground group-hover/tile:text-foreground">
          {title}
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
  const [failed, setFailed] = useState(false);
  if (location.kind === "file") {
    const picture = getComputerThumbnailUrl({
      hostPath: location.path,
      size: 512,
      theme: resolvedTheme,
    });
    if (picture && !failed) {
      return (
        <img
          alt=""
          className="size-full object-cover object-top"
          draggable={false}
          onError={() => {
            setFailed(true);
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
