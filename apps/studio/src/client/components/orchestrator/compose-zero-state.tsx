import {
  type Bookmark,
  bookmarksAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { type Icon } from "@phosphor-icons/react";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode } from "react";

import { AppIcon } from "./app-icon";
import { computerName } from "./computer-name";
import { PageSection } from "./page-section";
import { VisitedPageRows } from "./visited-page-rows";

/** How many pages lately seen the view lists. */
const RECENT_SHOWN = 12;

/**
 * The empty band under a draft's words: three tiles for what can be opened
 * beside it (the web, this Mac, apps), each a picture of the kind of thing
 * rather than of anything in it, and under them, apart, a slim strip for
 * attaching, which is also where files are dropped. The words keep the room
 * above; the strip sits at the band's foot.
 *
 * The web opens as a tab of the draft's own, at the browser's starting view;
 * This Mac opens the Finder at home the same way; Apps goes to where apps
 * live.
 */
export function ComposeZeroState({
  onAttachFiles,
  onAttachFolder,
  onOpenApps,
  onOpenBrowser,
  onOpenFolder,
}: {
  /** The file chooser, for the strip's button. */
  onAttachFiles: () => void;
  /** The folder chooser: a folder the chat may work in, attached rather than opened. */
  onAttachFolder: () => void;
  /** Takes the window to the Apps place. */
  onOpenApps: () => void;
  /** Opens the browser's starting view as a tab of the draft's. */
  onOpenBrowser: () => void;
  onOpenFolder: (hostPath: string) => void;
}) {
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const home = places.data?.favorites.find((place) => place.name === "Home");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-4">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <Tile icon={GlobeIcon} name="Browser" onOpen={onOpenBrowser} />
        <Tile
          icon={DesktopIcon}
          name={computerName()}
          onOpen={() => {
            onOpenFolder(home?.path ?? "~");
          }}
        />
        <Tile icon={SquaresFourIcon} name="Apps" onOpen={onOpenApps} />
      </div>
      <div className="mt-auto flex h-10 shrink-0 items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 text-[12px] text-gray-500 dark:border-gray-600 dark:text-gray-400">
        <span className="min-w-0 flex-1 truncate">Drop files here</span>
        <Chooser icon={PaperclipIcon} onPick={onAttachFiles}>
          Attach files
        </Chooser>
        <Chooser icon={FolderIcon} onPick={onAttachFolder}>
          Add a folder
        </Chooser>
      </div>
    </div>
  );
}

/**
 * The web's starting view, laid out as a browser's new tab: the sites kept
 * as large marks with their names under them, the way apps are, and the
 * pages lately seen under those as a list. The tab's own address row, over
 * it wherever it is drawn, is where an address goes. Anywhere it goes
 * arrives as a tab. A page is bookmarked from its own menu, and a right
 * click on its mark here offers to remove it.
 */
export function WebStart({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);
  const visited = useAtomValue(visitedPagesAtom);
  const gesturesFor = useGesturesFor();
  const recent = visited
    .filter((page) => !bookmarks.some((bookmark) => bookmark.url === page.url))
    .slice(0, RECENT_SHOWN)
    .map((page) => ({
      app: { name: hostOf(page.url), site: originOf(page.url) },
      page,
    }));

  /** The OS's menu over a bookmark: everywhere it opens, then removing it. */
  const showBookmarkMenu = async (bookmark: Bookmark) => {
    const { destinations } = gesturesFor({ kind: "page", url: bookmark.url });
    const items: RPCInput["utils"]["showContextMenu"]["items"] = [
      ...destinations.flatMap((destination, index) => [
        // The places it opens, then the clipboard, are two groups.
        ...(destination.id === "copy" && index > 0
          ? [{ separator: true }]
          : []),
        { id: destination.id, label: destination.label },
      ]),
      { separator: true },
      { id: "remove", label: "Remove from bookmarks" },
    ];
    const picked = await rpcClient.utils.showContextMenu.call({ items });
    if (picked.id === "remove") {
      setBookmarks((current) =>
        current.filter((kept) => kept.id !== bookmark.id),
      );
      return;
    }
    destinations.find((destination) => destination.id === picked.id)?.run();
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-7 pb-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <PageSection title="Bookmarks">
          {bookmarks.length > 0 ? (
            // Pulled in by the gap between a mark's box and its icon, so the
            // icons line up under the heading.
            <div className="-ml-4 flex flex-wrap gap-x-2 gap-y-4">
              {bookmarks.map((bookmark) => (
                <button
                  className="group flex w-24 flex-col items-center gap-1.5 rounded-xl py-2 text-center hover:bg-accent/50"
                  key={bookmark.id}
                  onClick={() => {
                    onOpenPage(bookmark.url);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void showBookmarkMenu(bookmark);
                  }}
                  title={`${bookmark.title}\n${bookmark.url}`}
                  type="button"
                >
                  {/* The site's own mark, bare: no plate around it, the way a
                      browser's new tab shows its shortcuts. */}
                  <AppIcon
                    className="size-14 bg-transparent p-0 shadow-none ring-0"
                    name={bookmark.title}
                    site={originOf(bookmark.url)}
                    size="xl"
                  />
                  <span className="w-full truncate text-[13px] leading-4 font-medium">
                    {bookmark.title || hostOf(bookmark.url)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a page to your bookmarks from its menu, and it shows here.
            </p>
          )}
        </PageSection>
        {recent.length > 0 && (
          <PageSection title="Recent pages">
            <div className="-mx-2">
              <VisitedPageRows isCompact onOpen={onOpenPage} visits={recent} />
            </div>
          </PageSection>
        )}
      </div>
    </div>
  );
}

/** One of the two choosers on the Attach strip: its own mark, so files and a folder read as the two things they are. */
function Chooser({
  children,
  icon: ChooserIcon,
  onPick,
}: {
  children: ReactNode;
  icon: Icon;
  onPick: () => void;
}) {
  return (
    <button
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground shadow-xs hover:bg-accent"
      onClick={onPick}
      type="button"
    >
      <ChooserIcon className="size-3.5 text-muted-foreground" />
      {children}
    </button>
  );
}

/** The site a page is on, as its bar would name it. */
function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url;
}

/**
 * One kind of thing the band can open, drawn large as that kind: its mark in
 * a pane of its own, the name under it. Never a picture of anything real in
 * it, so the three read as three choices rather than three things to read.
 */
function Tile({
  icon: TileIcon,
  name,
  onOpen,
}: {
  icon: Icon;
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="group/tile flex flex-col items-center gap-2 rounded-xl p-1.5 text-[12px] font-medium text-foreground hover:bg-black/4 dark:hover:bg-white/6"
      onClick={onOpen}
      type="button"
    >
      <span className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-card shadow-xs ring-1 ring-border/70 transition group-hover/tile:ring-border">
        <TileIcon className="size-9 text-muted-foreground transition group-hover/tile:text-foreground" />
      </span>
      <span className="max-w-full truncate">{name}</span>
    </button>
  );
}
