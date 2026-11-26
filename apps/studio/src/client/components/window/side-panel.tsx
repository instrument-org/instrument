import { targetOfAddress } from "@/client/bookmarks/address";
import {
  askedOfBookmark,
  useOpenAddress,
} from "@/client/bookmarks/open-address";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { useWindow } from "@/client/components/window/context";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { cn, isMacOS } from "@/client/lib/utils";
import {
  type BarItem,
  type Bookmark,
  type BookmarkFolder,
  barItems,
  OTHER_ROOT,
  rootItems,
} from "@/shared/bookmarks";
import { folderHref } from "@/shared/computer-href";
import { windowCardTop } from "@/shared/constants";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { AddressMark } from "./app-chip";
import { AppIcon } from "./app-icon";
import {
  type OpenAddress,
  BookmarkContextMenu,
  bookmarkClicks,
} from "./bookmark-menu";
import { bookmarkName } from "./bookmark-edits";
import { chatListOptions } from "./chat-list-query";
import { RecentChatRow } from "./chats-mark";
import { byLastUserMessage, type Chat, hasWords } from "./chats";
import { useShowChatGroup } from "./chat-group";
import { DeleteChatDialog } from "./delete-chat-dialog";
import {
  pressBookmark,
  pressPlace,
  pressShortcut,
} from "./drag/press-bookmark";
import { type Place, useFilesPlaces } from "./files-places";
import { TabRowControl } from "./tab-location-row";
import { useOwnApps } from "./use-own-apps";
import { useSidePanel } from "./side-panel-state";
import { useWindowTabs } from "./window-tabs";
import { chatHref } from "./window-href";

/** How many chats the panel lists before All chats, newest first. */
const RECENT_CHATS_SHOWN = 4;
/** How many loose bookmarks the panel lists before All bookmarks. */
const BOOKMARKS_SHOWN = 5;

/** Where the group up draws its side panel: the window's column at its right edge (`SidePanelSlot`). */
const sidePanelSlotAtom = atom<HTMLElement | null>(null);

/**
 * The window's column for the side panel, on its own ground at the right
 * edge as the sidebar is at the left, outside the card, inside the rail that
 * slides and sizes it. The tab with the keyboard in the group up draws the
 * panel into it (`SidePanelHere`), so a pick goes to that tab. It is there
 * while the panel is open or sliding shut.
 */
export function SidePanelSlot() {
  const setSlot = useSetAtom(sidePanelSlotAtom);
  return (
    <aside
      aria-label="Side Panel"
      className="flex min-h-0 flex-1 flex-col pr-2 pb-2 pl-1"
      ref={setSlot}
      style={{ paddingTop: windowCardTop(isMacOS()) }}
    />
  );
}

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
 * a new tab, a drag to wherever it goes. A chat open in a tab group brings
 * that group up instead, with its panel open. All chats and All bookmarks
 * show the whole list in the panel, with Back to the rest.
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
  const { setOpen, keepForPick } = useSidePanel(group);
  const appWindow = useWindow();
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
    if (targetOfAddress(address)?.kind === "page") {
      noteTypedPage(address);
    }
    openAddress(address, asked);
  };
  const openScreen: OpenAddress = (href, asked) => {
    if (asked === undefined) {
      keepForPick();
      onVisit(href);
    } else {
      appWindow.openScreen(href, askedOfBookmark(asked));
    }
  };
  const home = () => {
    setView("home");
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pl-1">
        {view !== "home" && (
          <button
            className="flex h-7 items-center gap-0.5 rounded-lg pr-2 pl-1 text-[13px] text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            onClick={home}
            type="button"
          >
            <CaretLeftIcon className="size-3.5" />
            Back
          </button>
        )}
        <span className="flex-1" />
        <TabRowControl
          chord="toggleSidePanel"
          disabled={false}
          icon={<XIcon className="size-4" />}
          label="Close Side Panel"
          onClick={() => {
            setOpen(false);
          }}
        />
      </div>
      <div className="-mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
        {view === "home" && (
          <>
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
          </>
        )}
        {view === "chats" && <AllChats group={group} open={openScreen} />}
        {view === "bookmarks" && <AllBookmarks open={open} />}
      </div>
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
      <div className="flex flex-wrap gap-1.5 px-2 pb-1">
        {apps.map((app) => {
          const page = `/apps/${app.slug}`;
          return (
            <button
              aria-label={app.name}
              className="grid size-8 cursor-default place-items-center rounded-lg bg-card shadow-xs ring-1 ring-foreground/8 hover:bg-accent"
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
  group,
  open,
}: {
  chats: Chat[];
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
  const chats = useListedChats().filter((chat) =>
    hasWords(search, [chat.title]),
  );
  return (
    <>
      <Heading>Chats</Heading>
      <label className="mx-1 mb-1 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-foreground/5 px-2.5 text-[13px] focus-within:bg-card focus-within:ring-1 focus-within:ring-foreground/20">
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
      {chats.length === 0 ? (
        <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
          No chats match.
        </p>
      ) : (
        <ChatRows chats={chats} group={group} open={open} />
      )}
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

function PlaceRow({ open, place }: { open: OpenAddress; place: Place }) {
  return (
    <button
      className={ROW}
      {...bookmarkClicks(folderHref(place.path), open)}
      onPointerDown={(event) => {
        pressPlace(event, place);
      }}
      title={place.path}
      type="button"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {place.icon}
      </span>
      <span className="min-w-0 truncate">{place.name}</span>
    </button>
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
  const bar = barItems(state);
  const others = rootItems(state, OTHER_ROOT);
  return (
    <>
      <Heading>Bookmarks</Heading>
      {bar.length === 0 && others.length === 0 ? (
        <p className="px-2 py-1 text-[13px] text-muted-foreground">
          Bookmarks you keep show up here.
        </p>
      ) : (
        <>
          {bar.length > 0 && (
            <FolderRow items={bar} open={open} title="Bookmarks bar" />
          )}
          <BookmarkItems items={others.slice(0, BOOKMARKS_SHOWN)} open={open} />
          <MoreRow label="All bookmarks" onClick={onAll} />
        </>
      )}
    </>
  );
}

/** Every bookmark: the bar's, open, then those kept off it. */
function AllBookmarks({ open }: { open: OpenAddress }) {
  const state = useAtomValue(bookmarksStateAtom);
  const bar = barItems(state);
  const others = rootItems(state, OTHER_ROOT);
  return (
    <>
      <Heading>Bookmarks</Heading>
      {bar.length > 0 && (
        <FolderRow
          isOpenAtFirst
          items={bar}
          open={open}
          title="Bookmarks bar"
        />
      )}
      <BookmarkItems items={others} open={open} />
    </>
  );
}

function BookmarkItems({
  depth = 0,
  items,
  open,
}: {
  depth?: number;
  items: BarItem[];
  open: OpenAddress;
}) {
  return items.map((item) =>
    item.kind === "folder" ? (
      <FolderRow
        depth={depth}
        folder={item.folder}
        items={item.items}
        key={item.folder.id}
        open={open}
        title={item.folder.title}
      />
    ) : (
      <BookmarkRow
        bookmark={item.bookmark}
        depth={depth}
        key={item.bookmark.id}
        open={open}
      />
    ),
  );
}

/** Indents a row under the folder it is in. */
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 16 });

function BookmarkRow({
  bookmark,
  depth,
  open,
}: {
  bookmark: Bookmark;
  depth: number;
  open: OpenAddress;
}) {
  return (
    <BookmarkContextMenu bookmark={bookmark} open={open}>
      <button
        className={ROW}
        {...bookmarkClicks(bookmark.url, open)}
        data-bookmark-id={bookmark.id}
        onPointerDown={(event) => {
          pressBookmark(event, bookmark);
        }}
        style={indent(depth)}
        title={`${bookmarkName(bookmark)}\n${bookmark.url}`}
        type="button"
      >
        <AddressMark address={bookmark.url} />
        <span className="min-w-0 truncate">{bookmarkName(bookmark)}</span>
      </button>
    </BookmarkContextMenu>
  );
}

/** A folder of bookmarks that opens in place, with how many it has. */
function FolderRow({
  depth = 0,
  folder,
  isOpenAtFirst = false,
  items,
  open,
  title,
}: {
  depth?: number;
  folder?: BookmarkFolder;
  isOpenAtFirst?: boolean;
  items: BarItem[];
  open: OpenAddress;
  title: string;
}) {
  const [isOpen, setOpen] = useState(isOpenAtFirst);
  return (
    <>
      <button
        aria-expanded={isOpen}
        className={ROW}
        {...(folder ? { "data-bookmark-folder": folder.id } : {})}
        onClick={() => {
          setOpen(!isOpen);
        }}
        style={indent(depth)}
        type="button"
      >
        <CaretRightIcon
          className={cn(
            "-ml-1 size-3 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-90",
          )}
          weight="bold"
        />
        <FolderSimpleIcon className="size-4 shrink-0 text-foreground/70" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {items.length}
        </span>
      </button>
      {isOpen && <BookmarkItems depth={depth + 1} items={items} open={open} />}
    </>
  );
}
