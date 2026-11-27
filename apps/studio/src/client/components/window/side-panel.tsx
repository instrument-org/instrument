import { targetOfAddress } from "@/client/bookmarks/address";
import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  askedOfBookmark,
  bookmarksToOpen,
  hrefOfTarget,
  useOpenAddress,
  useOpenAllBookmarks,
} from "@/client/bookmarks/open-address";
import {
  type DropTarget,
  dropTargetAt,
  type OutlineRow,
} from "@/client/bookmarks/outline";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { copyFolderPath } from "@/client/components/folder-row";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { useWindow } from "@/client/components/window/context";
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  sidePanelWidthAtom,
} from "@/client/atoms/tab-groups";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { useIsScrollable } from "@/client/hooks/use-is-scrollable";
import { useWindowPlaces } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import {
  type BarItem,
  type BookmarkFolder,
  type Bookmarks,
  barItems,
  bookmarksDirectlyIn,
  itemsOfFolder,
  OTHER_ROOT,
  rootItems,
  siblingsIn,
} from "@/shared/bookmarks";
import { folderHref } from "@/shared/computer-href";
import { windowCardTop } from "@/shared/constants";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { BookmarksSimpleIcon } from "@phosphor-icons/react/BookmarksSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AddressMark } from "./app-chip";
import { AppIcon } from "./app-icon";
import { FolderEditor } from "./bookmark-editor";
import { BookmarkNameDialog, FolderContextMenu } from "./bookmark-folders";
import {
  type OpenAddress,
  BookmarkContextMenu,
  bookmarkClicks,
  folderClicks,
  ManageBookmarksItem,
  NewFolderItem,
  ShowBookmarksBarItem,
} from "./bookmark-menu";
import { bookmarkName } from "./bookmark-edits";
import { chatListOptions } from "./chat-list-query";
import { type RowDensity, rowDensityAtom } from "./chat-list-view";
import { RecentChatRow } from "./chats-mark";
import { byLastUserMessage, type Chat, hasWords } from "./chats";
import { useShowChatGroup } from "./chat-group";
import { DeleteChatDialog } from "./delete-chat-dialog";
import {
  pressBookmark,
  pressFolder,
  pressPlace,
  pressShortcut,
} from "./drag/press-bookmark";
import { DROP_TONE } from "./drag/tone";
import { ViewButton } from "./filter-head";
import { GROUP_WIDTH_MIN } from "./group-sidebar";
import { useOutlineDrop, useOutlineTarget } from "./drag/use-bookmarks-drag";
import { type Place, useFilesPlaces } from "./files-places";
import { PlaceItems } from "./place-items";
import { TabRowControl } from "./tab-location-row";
import { useOwnApps } from "./use-own-apps";
import { useSidePanel } from "./side-panel-state";
import { useWindowTabs } from "./window-tabs";
import { isChatTab } from "./tab-model";
import { useProjectShift } from "./use-project-shift";
import { chatHref, matchScreen } from "./window-href";

/** How many chats the panel lists before All chats, newest first. */
const RECENT_CHATS_SHOWN = 4;
/** How many loose bookmarks the panel lists before All bookmarks. */
const BOOKMARKS_SHOWN = 5;

/** Where the group up draws its side panel: the window's column at its right edge (`SidePanelSlot`). */
const sidePanelSlotAtom = atom<HTMLElement | null>(null);

/** Dragged narrower than this, the side panel slides shut rather than stopping at its floor. */
const SIDE_PANEL_COLLAPSE_THRESHOLD = 180;

/**
 * How wide the side panel may be in a window whose group and panel share
 * `width`: the row less what the group keeps, within the panel's own floor
 * and ceiling.
 */
function sidePanelBounds(width: number): RailBounds {
  return {
    collapse: SIDE_PANEL_COLLAPSE_THRESHOLD,
    initial: SIDE_PANEL_WIDTH_DEFAULT,
    max: Math.min(
      SIDE_PANEL_WIDTH_MAX,
      Math.max(SIDE_PANEL_WIDTH_MIN, width - GROUP_WIDTH_MIN),
    ),
    min: SIDE_PANEL_WIDTH_MIN,
  };
}

/**
 * Whether a window whose group and panel share `width` has room for the
 * panel at `panelWidth` beside the group at its narrowest. The share is the
 * same with the panel out of the way, so the answer holds once the panel
 * goes or comes back, and only a change of the window or the sidebar turns it.
 */
export function sidePanelRoomOf(width: number, panelWidth: number): boolean {
  return width >= GROUP_WIDTH_MIN + panelWidth;
}

/**
 * The window's column for the side panel, on its own ground at the right
 * edge as the sidebar is at the left, outside the card: the sidebar's rail
 * mirrored, so it slides in and out and is resized as the sidebar is. It
 * shows the group up's panel and comes and goes at once as the group up
 * changes, and is there while the panel is open or sliding shut. The tab
 * with the keyboard in the group up draws the panel into it
 * (`SidePanelHere`), so a pick goes to that tab. Its ground moves the
 * window, as the sidebar's does, past what takes a click.
 */
export function SidePanelRail({
  group,
  isOpen,
  onCollapse,
  width,
}: {
  group: string | undefined;
  isOpen: boolean;
  onCollapse: () => void;
  /** The row the group and the panel share, in CSS px. */
  width: number;
}) {
  const setSlot = useSetAtom(sidePanelSlotAtom);
  return (
    <StudioSidebarRail
      bounds={sidePanelBounds(width)}
      contentKey={group}
      isOpen={isOpen}
      label="Resize the side panel"
      onCollapse={onCollapse}
      panelClassName="border-l-0 bg-transparent"
      side="right"
      unmountsWhenClosed
      widthAtom={sidePanelWidthAtom}
    >
      <aside
        aria-label="Side Panel"
        className={cn(
          "flex min-h-0 flex-1 flex-col pr-2 pb-2 pl-1",
          WINDOW_DRAG,
        )}
        ref={setSlot}
        style={{ paddingTop: windowCardTop(isMacOS()) }}
      />
    </StudioSidebarRail>
  );
}

/**
 * Ground that moves the window, as the sidebar's does; from a press until a
 * drag lets go it is the page's alone, so nothing carried onto it can be
 * taken for moving the window.
 */
const WINDOW_DRAG =
  "[-webkit-app-region:drag] in-data-pressing:[-webkit-app-region:no-drag] in-data-tab-held:[-webkit-app-region:no-drag]";

/** The corner's button that opens the side panel, shown only while it is closed. */
export function ShowSidePanelControl({ onClick }: { onClick: () => void }) {
  return (
    <TabRowControl
      chord="toggleSidePanel"
      disabled={false}
      icon={<SidebarSimpleIcon className="size-4 -scale-x-100" />}
      label="Show Side Panel"
      onClick={onClick}
    />
  );
}

/**
 * The side panel of the group this tab is in, drawn into the window's
 * column for it while that column is there: open, or sliding shut. `onOpen`
 * puts a site in this tab and `onVisit` a place of the app's own, as the
 * bookmarks bar does.
 */
export function SidePanelHere({
  group,
  onOpen,
  onVisit,
}: {
  group: string;
  onOpen: (url: string) => void;
  onVisit: (href: string) => void;
}) {
  const slot = useAtomValue(sidePanelSlotAtom);
  if (!slot) {
    return null;
  }
  return createPortal(
    <SidePanel group={group} onOpen={onOpen} onVisit={onVisit} />,
    slot,
  );
}

type View = "bookmarks" | "chats" | "home";

/**
 * Apps, Chats, Files and Bookmarks, each opening in the tab as a bookmark
 * does (`bookmarkClicks`): a click in place, Back returning, a Cmd-click in
 * a new tab, a drag to wherever it goes. A chat that is all its group shows
 * keeps its place: anything but a chat opens on the other side of it, which
 * takes the keyboard and so the picks after it. A chat open in a tab group
 * brings that group up instead, with its panel open. All chats and All
 * bookmarks show the whole list in the panel, with Back to the rest,
 * sliding in and back out as the sidebar steps into a project.
 */
function SidePanel({
  group,
  onOpen,
  onVisit,
}: {
  group: string;
  onOpen: (url: string) => void;
  onVisit: (href: string) => void;
}) {
  const [view, setView] = useState<View>("home");
  // The list and its name slide in from the right as a whole list opens,
  // and back from the left to the rest, as the sidebar steps into a
  // project; the close button stays put.
  const headShiftRef = useRef<HTMLDivElement>(null);
  const listShiftRef = useRef<HTMLDivElement>(null);
  const shownList = view === "home" ? undefined : view;
  useProjectShift(headShiftRef, shownList);
  useProjectShift(listShiftRef, shownList);
  const { setOpen, keepForPick } = useSidePanel(group);
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  // Whether a click on something at `href` (none for a site) opens beside
  // the chat the group shows alone rather than in its place.
  const opensBesideChat = (href: string | undefined) => {
    if (href !== undefined && matchScreen(href).kind === "chat") {
      return false;
    }
    const [only, other] = windowTabs.layoutOf(group).sides;
    const up = only?.tabs.find((tab) => tab.id === only.up);
    return other === undefined && up !== undefined && isChatTab(up);
  };
  const openAddress = useOpenAddress({
    loadHere: (url) => {
      keepForPick();
      onOpen(url);
    },
    visitHere: (href) => {
      keepForPick();
      onVisit(href);
    },
  });
  // A bookmark is an address the person chose, so opening a site's counts
  // the way typing it would.
  const open: OpenAddress = (address, asked) => {
    const target = targetOfAddress(address);
    if (target?.kind === "page") {
      noteTypedPage(address);
    }
    const href =
      target === undefined || target.kind === "page"
        ? undefined
        : hrefOfTarget(target);
    openAddress(
      address,
      asked ??
        (target && opensBesideChat(href) ? { into: "split" } : undefined),
    );
  };
  const openScreen: OpenAddress = (href, asked) => {
    if (asked === undefined && opensBesideChat(href)) {
      appWindow.openScreen(href, { into: "split" });
    } else if (asked === undefined) {
      keepForPick();
      onVisit(href);
    } else {
      appWindow.openScreen(href, askedOfBookmark(asked));
    }
  };
  const home = () => {
    setView("home");
  };
  // Gray and a little faint until the pointer or the keyboard is on it, or
  // a menu of its own is open, so its icons draw no eye away from the page.
  return (
    <div className="flex min-h-0 flex-1 flex-col opacity-85 grayscale transition-[filter,opacity] duration-200 hover:opacity-100 hover:grayscale-0 has-focus-visible:opacity-100 has-focus-visible:grayscale-0 has-data-[state=open]:opacity-100 has-data-[state=open]:grayscale-0">
      <PanelHead
        onClose={() => {
          setOpen(false);
        }}
        shiftRef={headShiftRef}
        {...(view !== "home" && {
          onBack: home,
          title: view === "chats" ? "Chats" : "Bookmarks",
        })}
      />
      <div className="flex min-h-0 flex-1 flex-col" ref={listShiftRef}>
        {view === "home" && (
          <PanelScroll>
            <AppsSection open={open} openScreen={openScreen} />
            <ChatsSection
              count={RECENT_CHATS_SHOWN}
              group={group}
              open={openScreen}
              onAll={() => {
                setView("chats");
              }}
            />
            <FilesSection group={group} open={openScreen} />
            <BookmarksSection
              onAll={() => {
                setView("bookmarks");
              }}
              open={open}
            />
          </PanelScroll>
        )}
        {view === "chats" && <AllChats group={group} open={openScreen} />}
        {view === "bookmarks" && (
          <PanelScroll>
            <BookmarkTree isBarOpenAtFirst open={open} />
          </PanelScroll>
        )}
      </div>
    </div>
  );
}

/**
 * The panel's top row: the close button at its end, and in a whole list,
 * Back and the list's name ahead of it.
 */
function PanelHead({
  onBack,
  onClose,
  shiftRef,
  title,
}: {
  onBack?: () => void;
  onClose: () => void;
  /** What slides as a whole list opens or closes: Back and the list's name. */
  shiftRef: RefObject<HTMLDivElement | null>;
  title?: string;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 pl-0.5 [&_button]:[-webkit-app-region:no-drag]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5" ref={shiftRef}>
        {onBack && (
          <TabRowControl
            disabled={false}
            icon={<CaretLeftIcon className="size-4" />}
            label="Back"
            onClick={onBack}
          />
        )}
        {title !== undefined && (
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {title}
          </h2>
        )}
      </div>
      <TabRowControl
        chord="toggleSidePanel"
        disabled={false}
        icon={<XIcon className="size-4" />}
        label="Close Side Panel"
        onClick={onClose}
      />
    </div>
  );
}

/**
 * What scrolls in the panel, fading out at an end with more past it. The
 * room under the last row moves the window, as the ground around it does.
 */
function PanelScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const isScrollable = useIsScrollable(ref);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto pb-2 [-webkit-app-region:no-drag]",
        isScrollable && "scroll-fade-y",
      )}
      ref={ref}
    >
      {children}
      <div className={cn("min-h-2 flex-1", WINDOW_DRAG)} />
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground first:pt-0">
      {children}
    </h3>
  );
}

const ROW =
  "flex h-7.5 w-full shrink-0 cursor-default items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground/85 hover:bg-foreground/6 hover:text-foreground data-[state=open]:bg-foreground/6";

/** A row that shows more of a section in the panel. */
function MoreRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className={cn(ROW, "text-muted-foreground")}
      onClick={onClick}
      type="button"
    >
      <ArrowRightIcon className="size-3.5 shrink-0" />
      {label}
    </button>
  );
}

/** The person's own apps as a row of icons; a pick goes to its site where it is signed in, else its page in Instrument. */
function AppsSection({
  open,
  openScreen,
}: {
  open: OpenAddress;
  openScreen: OpenAddress;
}) {
  const apps = useOwnApps().toSorted((a, b) => a.name.localeCompare(b.name));
  if (apps.length === 0) {
    return null;
  }
  return (
    <>
      <Heading>Apps</Heading>
      <div className="flex flex-wrap gap-0.5 px-0.5">
        {apps.map((app) => {
          const page = `/apps/${app.slug}`;
          return (
            <button
              aria-label={app.name}
              className="grid size-8 cursor-default place-items-center rounded-lg hover:bg-foreground/6 data-[state=open]:bg-foreground/6"
              key={app.slug}
              {...(app.opensAt === undefined
                ? bookmarkClicks(page, openScreen)
                : bookmarkClicks(app.opensAt, open))}
              onPointerDown={(event) => {
                pressShortcut(
                  event,
                  app.opensAt === undefined
                    ? { href: page, title: app.name }
                    : { title: app.name, url: app.opensAt },
                );
              }}
              title={app.name}
              type="button"
            >
              <AppIcon
                className="size-5"
                icon={app.icon}
                name={app.name}
                site={app.site}
                size="sm"
              />
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * A chat picked from the panel: the group it is open in comes up, with its
 * panel open, or a group closed with it comes back; else it opens in this tab.
 */
function useOpenChat(group: string, open: OpenAddress) {
  const windowTabs = useWindowTabs();
  const showChatGroup = useShowChatGroup();
  return (chat: ChatId) => {
    const there = windowTabs.chatTab(chat)?.group;
    if (!showChatGroup(chat, { from: group })) {
      open(chatHref(chat));
      return;
    }
    if (there !== undefined && there !== group) {
      windowTabs.setGroupOwn(there, { sidePanel: true });
    }
  };
}

function ChatRows({
  chats,
  density,
  group,
  open,
}: {
  chats: Chat[];
  density?: RowDensity;
  group: string;
  open: OpenAddress;
}) {
  const [deleting, setDeleting] = useState<Chat>();
  const openChat = useOpenChat(group, open);
  return (
    <>
      {chats.map((chat) => (
        <RecentChatRow
          chat={chat}
          {...(density && { density })}
          key={chat.id}
          onDelete={() => {
            setDeleting(chat);
          }}
          onOpen={() => {
            openChat(chat.id);
          }}
          onPress={(event) => {
            pressShortcut(event, {
              href: chatHref(chat.id),
              title: chat.title,
            });
          }}
        />
      ))}
      {deleting && (
        <DeleteChatDialog
          chat={deleting}
          onDeleted={() => {
            setDeleting(undefined);
          }}
          onOpenChange={(isShown) => {
            if (!isShown) {
              setDeleting(undefined);
            }
          }}
          open
        />
      )}
    </>
  );
}

function useListedChats() {
  const { data } = useQuery(chatListOptions());
  return byLastUserMessage((data ?? []).filter((chat) => !chat.archived));
}

function ChatsSection({
  count,
  group,
  onAll,
  open,
}: {
  count: number;
  group: string;
  onAll: () => void;
  open: OpenAddress;
}) {
  const chats = useListedChats();
  if (chats.length === 0) {
    return null;
  }
  return (
    <>
      <Heading>Chats</Heading>
      <ChatRows chats={chats.slice(0, count)} group={group} open={open} />
      {chats.length > count && <MoreRow label="All chats" onClick={onAll} />}
    </>
  );
}

/** Every chat not archived, newest first, narrowed by what is typed above them. */
function AllChats({ group, open }: { group: string; open: OpenAddress }) {
  const [search, setSearch] = useState("");
  const density = useAtomValue(rowDensityAtom);
  const chats = useListedChats().filter((chat) =>
    hasWords(search, [chat.title]),
  );
  return (
    <>
      <div className="mb-1 flex shrink-0 items-center gap-1 pl-1 [&_button]:[-webkit-app-region:no-drag]">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-foreground/5 px-2.5 text-[13px] [-webkit-app-region:no-drag] focus-within:bg-card focus-within:ring-1 focus-within:ring-foreground/20">
          <MagnifyingGlassIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search chats"
            type="search"
            value={search}
          />
        </label>
        <ViewButton className="size-8" hasDayHeadings={false} />
      </div>
      <PanelScroll>
        {chats.length === 0 ? (
          <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
            No chats match.
          </p>
        ) : (
          <ChatRows chats={chats} density={density} group={group} open={open} />
        )}
      </PanelScroll>
    </>
  );
}

/** The places of this group's Files sidebar, its project's folder first where it has one. */
function FilesSection({ group, open }: { group: string; open: OpenAddress }) {
  const { places, project } = useFilesPlaces(group);
  const shown = project ? [project, ...places] : places;
  if (shown.length === 0) {
    return null;
  }
  return (
    <>
      <Heading>Files</Heading>
      {shown.map((place) => (
        <PlaceRow key={place.path} open={open} place={place} />
      ))}
    </>
  );
}

/** A folder of Files' sidebar: it opens and drags as a bookmark does, and its menu opens it elsewhere or copies its path. */
function PlaceRow({ open, place }: { open: OpenAddress; place: Place }) {
  const href = folderHref(place.path);
  const placesOf = useWindowPlaces();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={ROW}
          {...bookmarkClicks(href, open)}
          onPointerDown={(event) => {
            pressPlace(event, { ...place, shortcut: true });
          }}
          title={place.path}
          type="button"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            {place.icon}
          </span>
          <span className="min-w-0 truncate">{place.name}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem
          onClick={() => {
            open(href);
          }}
        >
          <ArrowSquareInIcon className="size-4" />
          <span>Open</span>
        </ContextMenuItem>
        <PlaceItems
          components={contextMenuComponents}
          destinations={placesOf((options) => {
            open(href, options);
          })}
        />
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void copyFolderPath(place.path)}>
          <ClipboardTextIcon className="size-4" />
          <span>Copy Path</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The bookmarks bar as a folder, then the bookmarks kept off the bar, the first few. */
function BookmarksSection({
  onAll,
  open,
}: {
  onAll: () => void;
  open: OpenAddress;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const isEmpty =
    barItems(state).length === 0 && rootItems(state, OTHER_ROOT).length === 0;
  return (
    <>
      <Heading>Bookmarks</Heading>
      {isEmpty ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground">
          Bookmarks you keep show up here.
        </p>
      ) : (
        <>
          <BookmarkTree open={open} othersShown={BOOKMARKS_SHOWN} />
          <MoreRow label="All bookmarks" onClick={onAll} />
        </>
      )}
    </>
  );
}

/** The bookmarks bar's row in the panel, which opens in place over the bar's items. */
const BAR_ROW = ":bar";

/** A row of the panel's bookmarks: the bar's, or a folder or bookmark as the Bookmarks page has them. */
type PanelRow =
  | { count: number; id: typeof BAR_ROW; isOpen: boolean; kind: "bar" }
  | Extract<OutlineRow, { kind: "bookmark" | "folder" }>;

/**
 * The rows the panel lists: the bar as a folder, with its items under it
 * while it is open, then the first `othersShown` of those kept off it, each
 * folder over what is in it while it is open.
 */
function panelRows(
  state: Bookmarks,
  isOpen: ReadonlySet<string>,
  othersShown: number,
): PanelRow[] {
  const rowsIn = (items: readonly BarItem[], depth: number): PanelRow[] =>
    items.flatMap((item): PanelRow[] => {
      if (item.kind === "bookmark") {
        return [
          {
            bookmark: item.bookmark,
            depth,
            id: item.bookmark.id,
            kind: "bookmark",
          },
        ];
      }
      const { folder, items: within } = item;
      const isFolderOpen = isOpen.has(folder.id);
      return [
        {
          count: within.length,
          depth,
          folder,
          id: folder.id,
          isOpen: isFolderOpen,
          kind: "folder",
        },
        ...(isFolderOpen ? rowsIn(within, depth + 1) : []),
      ];
    });
  const bar = barItems(state);
  const isBarOpen = isOpen.has(BAR_ROW);
  const barRow: PanelRow = {
    count: bar.length,
    id: BAR_ROW,
    isOpen: isBarOpen,
    kind: "bar",
  };
  return [
    ...(bar.length > 0 ? [barRow, ...(isBarOpen ? rowsIn(bar, 1) : [])] : []),
    ...rowsIn(rootItems(state, OTHER_ROOT).slice(0, othersShown), 0),
  ];
}

/**
 * Where something held over a row of the panel's bookmarks lands: the
 * bar's row takes it at the bar's end, or first in the bar from its lower
 * half while it is open; a folder or a bookmark as on the Bookmarks page
 * (`dropTargetAt`).
 */
function panelTargetAt(
  state: Bookmarks,
  row: PanelRow | undefined,
  fraction: number,
  held: ReadonlySet<string>,
): DropTarget | undefined {
  if (row?.kind !== "bar") {
    return row && dropTargetAt(state, [row], 0, fraction, held);
  }
  if (row.isOpen && fraction > 0.5) {
    return {
      kind: "between",
      line: { after: BAR_ROW },
      place: {
        before: siblingsIn(state, undefined).find((each) => !held.has(each.id))
          ?.id,
      },
    };
  }
  return { id: BAR_ROW, kind: "into", place: {} };
}

/**
 * The panel's bookmarks as an outline, each row as it is on the bar: a
 * bookmark opens and drags as one there, and a folder opens in place,
 * drags as one, and opens all on a Cmd-click; each has the bar's menu on a
 * right click. What is held lands among the rows (`useOutlineTarget`).
 */
function BookmarkTree({
  isBarOpenAtFirst = false,
  open,
  othersShown = Infinity,
}: {
  isBarOpenAtFirst?: boolean;
  open: OpenAddress;
  othersShown?: number;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const store = useStore();
  const openAll = useOpenAllBookmarks();
  const folders = useBookmarkFolders();
  const [isOpen, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(isBarOpenAtFirst ? [BAR_ROW] : []),
  );
  // A folder being named in a dialog: a new one, placed after the item
  // whose menu asked for it, or one under a new name.
  const [naming, setNaming] = useState<
    | { after?: string; kind: "folder" }
    | { folder: BookmarkFolder; kind: "rename" }
  >();
  const list = useRef<HTMLDivElement>(null);
  const rows = panelRows(state, isOpen, othersShown);
  useOutlineTarget({
    isOff: false,
    list: () => list.current,
    targetAt: (now, index, ...at) =>
      panelTargetAt(now, panelRows(now, isOpen, othersShown)[index], ...at),
  });
  const drop = useOutlineDrop();
  const toggle = (id: string) => {
    const next = new Set(isOpen);
    if (!next.delete(id)) {
      next.add(id);
    }
    setOpen(next);
  };
  return (
    <>
      <div className="flex flex-col" ref={list}>
        {rows.map((row) => {
          const at = drop.row?.id === row.id ? drop.row.at : undefined;
          const marks = {
            className: cn(
              ROW,
              "relative",
              at === "into" && DROP_TONE,
              drop.held.has(row.id) && "opacity-40",
            ),
            "data-outline-row": row.id,
          };
          const line = at === "before" || at === "after" ? at : undefined;
          if (row.kind === "bar") {
            return (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>
                  <button
                    {...marks}
                    aria-expanded={row.isOpen}
                    onClick={() => {
                      toggle(row.id);
                    }}
                    type="button"
                  >
                    <DropLine at={line} />
                    <BookmarksSimpleIcon className="size-4 shrink-0 text-foreground/70" />
                    <span className="min-w-0 flex-1 truncate">
                      Bookmarks bar
                    </span>
                    <Count count={row.count} />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-52">
                  <NewFolderItem
                    onSelect={() => {
                      setNaming({ kind: "folder" });
                    }}
                  />
                  <ManageBookmarksItem />
                  <ContextMenuSeparator />
                  <ShowBookmarksBarItem />
                </ContextMenuContent>
              </ContextMenu>
            );
          }
          if (row.kind === "folder") {
            const { folder } = row;
            const clicks = folderClicks(() => {
              openAll(
                bookmarksToOpen(store.get(bookmarksStateAtom), folder.id),
                "group",
              );
            });
            return (
              <FolderContextMenu
                folder={folder}
                key={row.id}
                onNewFolder={() => {
                  setNaming({ after: folder.id, kind: "folder" });
                }}
                onRename={() => {
                  setNaming({ folder, kind: "rename" });
                }}
              >
                <button
                  {...marks}
                  {...clicks}
                  aria-expanded={row.isOpen}
                  data-bookmark-folder={folder.id}
                  onClick={(event) => {
                    clicks.onClick(event);
                    if (!event.defaultPrevented) {
                      toggle(row.id);
                    }
                  }}
                  onPointerDown={(event) => {
                    pressFolder(
                      event,
                      folder,
                      bookmarksDirectlyIn(itemsOfFolder(state, folder.id)),
                    );
                  }}
                  style={indent(row.depth)}
                  title={folder.title}
                  type="button"
                >
                  <DropLine at={line} />
                  <BookmarkFolderIcon isOpen={row.isOpen} />
                  <span className="min-w-0 flex-1 truncate">
                    {folder.title}
                  </span>
                  <Count count={row.count} />
                </button>
              </FolderContextMenu>
            );
          }
          const { bookmark } = row;
          return (
            <BookmarkContextMenu
              bookmark={bookmark}
              key={row.id}
              onNewFolder={() => {
                setNaming({ after: bookmark.id, kind: "folder" });
              }}
              open={open}
            >
              <button
                {...marks}
                {...bookmarkClicks(bookmark.url, open)}
                data-bookmark-id={bookmark.id}
                onPointerDown={(event) => {
                  pressBookmark(event, bookmark);
                }}
                style={indent(row.depth)}
                title={`${bookmarkName(bookmark)}\n${bookmark.url}`}
                type="button"
              >
                <DropLine at={line} />
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <AddressMark address={bookmark.url} />
                </span>
                <span className="min-w-0 truncate">
                  {bookmarkName(bookmark)}
                </span>
              </button>
            </BookmarkContextMenu>
          );
        })}
      </div>
      {naming?.kind === "folder" && (
        <FolderEditor
          after={naming.after}
          onClose={() => {
            setNaming(undefined);
          }}
        />
      )}
      {naming?.kind === "rename" && (
        <BookmarkNameDialog
          action="Save"
          name={naming.folder.title}
          onClose={() => {
            setNaming(undefined);
          }}
          onCommit={(title) => {
            folders.rename(naming.folder, title);
          }}
          title="Rename folder"
        />
      )}
    </>
  );
}

/** Indents a row under the folder it is in. */
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 16 });

/** A folder's mark, open while its items show under it. */
function BookmarkFolderIcon({ isOpen }: { isOpen: boolean }) {
  const Icon = isOpen ? FolderOpenIcon : FolderIcon;
  return <Icon className="size-4 shrink-0 text-foreground/70" />;
}

function Count({ count }: { count: number }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
  );
}

/** Where something held would land beside a row: above it or below it. */
function DropLine({ at }: { at: "after" | "before" | undefined }) {
  if (at === undefined) {
    return null;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary",
        at === "before" ? "-top-px" : "-bottom-px",
      )}
      data-slot="bookmark-drop-line"
    />
  );
}
