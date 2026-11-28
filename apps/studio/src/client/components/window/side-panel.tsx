import { BookmarksIcon } from "@phosphor-icons/react/Bookmarks";
import { CopyIcon } from "@phosphor-icons/react/Copy";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useWindow } from "@/client/components/window/context";
import { APPS_HREF } from "@/client/atoms/window";
import {
  SIDE_PANEL_WIDTH_DEFAULT,
  SIDE_PANEL_WIDTH_MAX,
  SIDE_PANEL_WIDTH_MIN,
  sidePanelWidthAtom,
} from "@/client/atoms/tab-groups";
import { noteTypedPage } from "@/client/hooks/use-browser-history";
import { useWindowPlaces } from "@/client/hooks/use-open-target";
import { cn, isMacOS, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { applyDraftOpsAtom } from "@/client/drafts/store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
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
import { WINDOW_CARD_GAP, windowCardTop } from "@/shared/constants";
import {
  type BrowserTargetId,
  type ChatId,
} from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { ArrowSquareInIcon } from "@phosphor-icons/react/ArrowSquareIn";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CloudIcon } from "@phosphor-icons/react/Cloud";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AddressMark } from "./app-chip";
import { AppIcon } from "./app-icon";
import { FolderEditor } from "./bookmark-editor";
import {
  ExtensionSidePanelView,
  useExtensionSidePanelOf,
  useExtensionSidePanelPages,
} from "./extension-side-panel";
import { FolderMark } from "./folder-mark";
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
import { type RowDensity, sidePanelRowDensityAtom } from "./chat-list-view";
import { RecentChatRow } from "./chats-mark";
import {
  byLastUserMessage,
  type Chat,
  type ChatFilters,
  type ChatPlace,
  draftTitle,
  emptyLineFor,
  hasWords,
  matchesFilters,
  NO_PROJECT,
  outsideFilters,
  type Project,
  shortActivityLabel,
} from "./chats";
import { useShowChatGroup } from "./chat-group";
import { DeleteChatDialog } from "./delete-chat-dialog";
import {
  pressBookmark,
  pressFolder,
  pressPlace,
  pressShortcut,
} from "./drag/press-bookmark";
import { DROP_TONE } from "./drag/tone";
import { DraftRow } from "./draft-row";
import { TAGS, ViewButton } from "./filter-head";
import { GROUP_WIDTH_MIN } from "./group-sidebar";
import { SIDE_WIDTH_MIN } from "./side-widths";
import {
  useAllBookmarksTarget,
  useOutlineDrop,
  useOutlineTarget,
} from "./drag/use-bookmarks-drag";
import { type Place, useFilesPlaces } from "./files-places";
import { PlaceItems } from "./place-items";
import { TabRowControl } from "./tab-location-row";
import { useOwnApps } from "./use-own-apps";
import {
  sidePanelChatFiltersAtom,
  type SidePanelView,
  sidePanelViewAtom,
  useSidePanel,
} from "./side-panel-state";
import { useWindowTabs } from "./window-tabs";
import { isChatTab } from "./tab-model";
import { useProjectShift } from "./use-project-shift";
import { PickList } from "./pick-list";
import { projectColor } from "./project-colors";
import { ProjectMark } from "./project-mark";
import { NoProjectMark } from "./project-menu";
import { projectTint } from "./project-tint";
import { SearchField } from "./search-field";
import { useShell } from "./shell-context";
import { useMinuteClock } from "./use-minute-clock";
import { chatHref, matchScreen, newChatHref } from "./window-href";

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

/** The least a group with one side keeps beside the side panel before the panel steps away. */
const ONE_SIDE_BESIDE_PANEL = 640;
/** The least each side of a split keeps beside the side panel before the panel steps away. */
const SPLIT_SIDE_BESIDE_PANEL = 420;

/**
 * Whether a window whose group and panel share `width` has room for the
 * panel at `panelWidth` beside the group's `sides`, each at a width that
 * still reads well. The share is the same with the panel out of the way, so
 * the answer holds once the panel goes or comes back.
 */
export function sidePanelRoomOf(
  width: number,
  panelWidth: number,
  sides: number,
): boolean {
  const group =
    sides > 1 ? sides * SPLIT_SIDE_BESIDE_PANEL : ONE_SIDE_BESIDE_PANEL;
  return width >= group + panelWidth;
}

/**
 * Whether the group's `sides` fit at their narrowest beside the panel at
 * `panelWidth`, in a window whose group and panel share `width`. Past this
 * the sides would scroll sideways, so the panel steps away.
 */
export function sidesFitBesidePanel(
  width: number,
  panelWidth: number,
  sides: number,
): boolean {
  const group = sides * SIDE_WIDTH_MIN + (sides - 1) * WINDOW_CARD_GAP;
  return width >= group + panelWidth;
}

/**
 * The window's column for the side panel, on its own ground at the right
 * edge as the sidebar is at the left, outside the card: the sidebar's rail
 * mirrored, so it slides in and out and is resized as the sidebar is. It
 * shows the group up's panel and comes and goes at once as the group up
 * changes, and is there while the panel is open or sliding shut. The tab
 * with the keyboard in the group up draws the panel into it
 * (`SidePanelHere`), so a pick goes to that tab. Its ground moves the
 * window, as the sidebar's does, past what takes a click. It keeps the
 * pages of the extension side panels open in this window's tabs, whether
 * shown or not.
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
  useExtensionSidePanelPages();
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
 * The side panel floating over the group's far edge, in a window with no
 * room for it beside the group: shown by the person all the same, by its
 * chord or a chat's crumb. Escape puts it away, and a pick that changes the
 * tab up or another group coming up takes it off the group.
 */
export function SidePanelFloat({
  group,
  onClose,
  onDismiss,
}: {
  group: string | undefined;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const setSlot = useSetAtom(sidePanelSlotAtom);
  const width = useAtomValue(sidePanelWidthAtom);
  const windowTabs = useWindowTabs();
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const side = layout?.sides[layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  const where = [
    group ?? "",
    up?.id ?? "",
    up === undefined ? "" : up.kind === "screen" ? up.href : up.url,
  ].join("\n");
  const was = useRef(where);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (was.current !== where) {
      dismiss();
    }
  }, [where]);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    // Whatever in the panel takes Escape first (the search, a menu) keeps it.
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        close();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => {
      window.removeEventListener("keydown", keyDown);
    };
  }, []);
  return (
    <aside
      aria-label="Side Panel"
      className="absolute right-3 bottom-3 z-30 flex min-h-0 flex-col rounded-xl bg-ground pr-1 pb-1 pl-1 shadow-xl ring-1 ring-foreground/10"
      ref={setSlot}
      style={{ top: windowCardTop(isMacOS()) + 4, width }}
    />
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
  targetId,
}: {
  group: string;
  onOpen: (url: string) => void;
  onVisit: (href: string) => void;
  /** The page this tab shows, whose extension side panel, when it has one open, shows in place of the panel's own contents. */
  targetId: BrowserTargetId | undefined;
}) {
  const slot = useAtomValue(sidePanelSlotAtom);
  const extensionPanel = useExtensionSidePanelOf(targetId);
  if (!slot) {
    return null;
  }
  return createPortal(
    extensionPanel ? (
      <ExtensionSidePanelView key={targetId} panel={extensionPanel} />
    ) : (
      <SidePanel group={group} onOpen={onOpen} onVisit={onVisit} />
    ),
    slot,
  );
}

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
  const [view, setView] = useAtom(sidePanelViewAtom(group));
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
  const columnRef = useRef<HTMLDivElement>(null);
  const pointer = usePointerInColumn(columnRef);
  // Gray and a little faint until the pointer or the keyboard is on it, or
  // a menu of its own is open, so its icons draw no eye away from the page.
  return (
    <div
      className="@container flex min-h-0 flex-1 flex-col opacity-85 grayscale transition-[filter,opacity] duration-200 has-focus-visible:opacity-100 has-focus-visible:grayscale-0 has-data-[state=open]:opacity-100 has-data-[state=open]:grayscale-0 data-pointer-in:opacity-100 data-pointer-in:grayscale-0"
      data-pointer-in={pointer.isIn || undefined}
      onPointerEnter={pointer.onPointerEnter}
      ref={columnRef}
    >
      <PanelHead
        onClose={() => {
          setOpen(false);
        }}
        shiftRef={headShiftRef}
        {...(view !== "home" && { onBack: home, title: VIEW_TITLES[view] })}
      />
      <div className="flex min-h-0 flex-1 flex-col" ref={listShiftRef}>
        {view === "home" && (
          <PanelScroll>
            <AppsSection
              onAll={() => {
                setView("apps");
              }}
              open={open}
              openScreen={openScreen}
            />
            <ChatsSection
              count={RECENT_CHATS_SHOWN}
              group={group}
              open={openScreen}
              onAll={() => {
                setView("chats");
              }}
            />
            <FilesSection
              group={group}
              onAll={() => {
                setView("files");
              }}
              open={openScreen}
            />
            <BookmarksSection
              onAll={() => {
                setView("bookmarks");
              }}
              open={open}
            />
          </PanelScroll>
        )}
        {view === "apps" && <AllApps open={open} openScreen={openScreen} />}
        {view === "chats" && <AllChats group={group} open={openScreen} />}
        {view === "files" && <ComputerPlaces open={openScreen} />}
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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y pb-2 [-webkit-app-region:no-drag]">
      {children}
      <div className={cn("min-h-2 flex-1", WINDOW_DRAG)} />
    </div>
  );
}

/**
 * A section's name over its rows. Given `opens`, the clicks of the place
 * that shows all of the section, it is a button there with a caret after it.
 */
function Heading({
  children,
  opens,
}: {
  children: ReactNode;
  opens?: Pick<
    ComponentProps<"button">,
    "onAuxClick" | "onClick" | "onContextMenu"
  >;
}) {
  return (
    <h3 className="flex h-6 items-center text-xs font-medium text-muted-foreground not-first:mt-2">
      {opens ? (
        <button
          className="group/heading flex h-6 cursor-default items-center gap-0.5 rounded-md px-2 hover:bg-foreground/6 hover:text-foreground"
          type="button"
          {...opens}
        >
          {children}
          <CaretRightIcon className="size-3 opacity-60 group-hover/heading:opacity-100" />
        </button>
      ) : (
        <span className="px-2">{children}</span>
      )}
    </h3>
  );
}

const ROW =
  "flex h-7 w-full shrink-0 cursor-default items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground/85 hover:bg-foreground/6 hover:text-foreground data-[state=open]:bg-foreground/6";

/** A section with nothing in it yet: a dashed slot with an icon, set apart from the heading over it. */
const EMPTY_SLOT =
  "flex min-h-9 w-full shrink-0 cursor-default items-center gap-2 rounded-lg border border-dashed border-foreground/15 px-2.5 py-2 text-left text-[13px] text-muted-foreground";

/** A row that shows more of a section in the panel. */
function MoreRow({
  className,
  label,
  onClick,
}: {
  className?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(ROW, "text-muted-foreground", className)}
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
  onAll,
  open,
  openScreen,
}: {
  onAll: () => void;
  open: OpenAddress;
  openScreen: OpenAddress;
}) {
  const apps = useOwnApps().toSorted((a, b) => a.name.localeCompare(b.name));
  if (apps.length === 0) {
    return (
      <>
        <Heading opens={{ onClick: onAll }}>Apps</Heading>
        <button
          className={cn(
            EMPTY_SLOT,
            "text-foreground/85 hover:border-foreground/30 hover:bg-foreground/4 hover:text-foreground",
          )}
          {...bookmarkClicks(APPS_HREF, openScreen)}
          type="button"
        >
          <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
          Add an app
        </button>
      </>
    );
  }
  return (
    <>
      <Heading opens={{ onClick: onAll }}>Apps</Heading>
      <div className="flex flex-wrap gap-0.5 px-0.5">
        {apps.map((app) => (
          // Below the icon, clear of the window's top edge the row sits by.
          <Tooltip key={app.slug}>
            <AppMenu app={app} open={open} openScreen={openScreen}>
              <TooltipTrigger asChild>
                <button
                  aria-label={app.name}
                  className="grid size-8 cursor-default place-items-center rounded-lg hover:bg-foreground/6 data-[state=open]:bg-foreground/6"
                  {...appClicks(app, open, openScreen)}
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
              </TooltipTrigger>
            </AppMenu>
            <TooltipContent side="bottom">{app.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </>
  );
}

type OwnApp = ReturnType<typeof useOwnApps>[number];

/** What a press on an app does: its site where it is signed in, else its page in Instrument, and a drag takes it as a shortcut. */
function appClicks(app: OwnApp, open: OpenAddress, openScreen: OpenAddress) {
  const page = `/apps/${app.slug}`;
  return {
    ...(app.opensAt === undefined
      ? bookmarkClicks(page, openScreen)
      : bookmarkClicks(app.opensAt, open)),
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      pressShortcut(
        event,
        app.opensAt === undefined
          ? { href: page, title: app.name }
          : { title: app.name, url: app.opensAt },
      );
    },
  };
}

/**
 * The menu over one of the panel's apps: opening it here or in a place of
 * the window's own, as over a bookmark, then Manage, its page in Instrument,
 * where a press goes to its site instead.
 */
function AppMenu({
  app,
  children,
  open,
  openScreen,
}: {
  app: OwnApp;
  children: ReactElement;
  open: OpenAddress;
  openScreen: OpenAddress;
}) {
  const placesOf = useWindowPlaces();
  const page = `/apps/${app.slug}`;
  const { opensAt } = app;
  const go = (options?: Parameters<OpenAddress>[1]) => {
    if (opensAt === undefined) {
      openScreen(page, options);
    } else {
      open(opensAt, options);
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        <ContextMenuItem
          onClick={() => {
            go();
          }}
        >
          <ArrowSquareInIcon className="size-4" />
          <span>Open</span>
        </ContextMenuItem>
        <PlaceItems
          components={contextMenuComponents}
          destinations={placesOf(go)}
        />
        {opensAt !== undefined && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                openScreen(page);
              }}
            >
              <GearSixIcon className="size-4" />
              <span>Manage</span>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Every app of the person's by name, then the way to the Apps page, where another is added. */
function AllApps({
  open,
  openScreen,
}: {
  open: OpenAddress;
  openScreen: OpenAddress;
}) {
  const apps = useOwnApps().toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <PanelScroll>
      {apps.map((app) => (
        <AppMenu app={app} key={app.slug} open={open} openScreen={openScreen}>
          <button
            className={ROW}
            {...appClicks(app, open, openScreen)}
            type="button"
          >
            <AppIcon
              className="size-4 shrink-0"
              icon={app.icon}
              name={app.name}
              site={app.site}
              size="sm"
            />
            <span className="min-w-0 truncate">{app.name}</span>
          </button>
        </AppMenu>
      ))}
      <AddAppRow openScreen={openScreen} />
    </PanelScroll>
  );
}

/** Opens the Apps page, where a new app is found and connected. */
function AddAppRow({ openScreen }: { openScreen: OpenAddress }) {
  return (
    <button
      className={cn(ROW, "text-muted-foreground")}
      {...bookmarkClicks(APPS_HREF, openScreen)}
      type="button"
    >
      <PlusIcon className="size-4 shrink-0" />
      Add an app
    </button>
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
          shortTime={shortActivityLabel}
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
      <Heading opens={{ onClick: onAll }}>Chats</Heading>
      <ChatRows chats={chats.slice(0, count)} group={group} open={open} />
      {chats.length > count && <MoreRow label="All chats" onClick={onAll} />}
    </>
  );
}

/**
 * Whether the pointer is over the panel's column. The column's ground moves
 * the window, and over it the page gets no pointer events, so `:hover` would
 * end in every gap between rows. The pointer counts as in from the moment it
 * enters until it moves somewhere outside the column, or out of the window.
 */
function usePointerInColumn(ref: RefObject<HTMLElement | null>) {
  const [isIn, setIn] = useState(false);
  useEffect(() => {
    if (!isIn) {
      return;
    }
    const moved = (event: PointerEvent) => {
      const column = ref.current?.closest("aside")?.getBoundingClientRect();
      if (
        !column ||
        event.clientX < column.left ||
        event.clientX > column.right ||
        event.clientY < column.top ||
        event.clientY > column.bottom
      ) {
        setIn(false);
      }
    };
    const left = () => {
      setIn(false);
    };
    document.addEventListener("pointermove", moved);
    document.documentElement.addEventListener("pointerleave", left);
    return () => {
      document.removeEventListener("pointermove", moved);
      document.documentElement.removeEventListener("pointerleave", left);
    };
  }, [isIn, ref]);
  return {
    isIn,
    onPointerEnter: () => {
      setIn(true);
    },
  };
}

/** What each list the panel opens over the rest is called in its head. */
const VIEW_TITLES = {
  apps: "Apps",
  bookmarks: "Bookmarks",
  chats: "Chats",
  files: osConventions().computer,
} satisfies Record<Exclude<SidePanelView, "home">, string>;

/**
 * The chats, newest first, narrowed by the search and its marks, by Drafts or
 * Archived, and by one project (or none) from the selector at the row's end.
 * Nothing picked is every chat not archived. A search that finds chats the
 * filters keep out counts them on a rule under the list, which shows them
 * under it when pressed.
 */
function AllChats({ group, open }: { group: string; open: OpenAddress }) {
  const [filters, setFilters] = useAtom(sidePanelChatFiltersAtom(group));
  const density = useAtomValue(sidePanelRowDensityAtom);
  const shell = useShell();
  const keepDraft = useSetAtom(applyDraftOpsAtom);
  const now = useMinuteClock();
  const { data } = useQuery(chatListOptions());
  const chats = data ?? [];
  const projects =
    useQuery(rpcClient.workspace.projects.list.queryOptions()).data ?? [];
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const matched = byLastUserMessage(
    chats.filter((chat) => matchesFilters(chat, filters, projectNames)),
  );
  const outside = outsideFilters(chats, filters, projectNames);
  // The matches outside the filters, once asked for, show under the list
  // while the same view is searched.
  const viewKey = JSON.stringify({ ...filters, search: "" });
  const [widenedIn, setWidenedIn] = useState<string>();
  if (
    widenedIn !== undefined &&
    (filters.search.trim() === "" || widenedIn !== viewKey)
  ) {
    setWidenedIn(undefined);
  }
  const shownOutside = widenedIn === viewKey ? byLastUserMessage(outside) : [];
  const isDrafts = filters.place === "drafts";
  const drafts = isDrafts
    ? shell.drafts.filter(
        (draft) =>
          (filters.projects.length === 0 ||
            filters.projects.includes(draft.projectId ?? NO_PROJECT)) &&
          hasWords(filters.search, [
            draftTitle(draft.words),
            draft.words,
            projectNames.get(draft.projectId ?? "") ?? "",
          ]),
      )
    : [];
  // A mark is offered while the view, before any mark narrows it, has a chat
  // carrying it; a draft carries neither.
  const unmarked = { ...filters, search: "", tags: [] };
  const offered = isDrafts
    ? []
    : TAGS.filter((tag) =>
        chats.some(
          (chat) =>
            chat[tag.id] && matchesFilters(chat, unmarked, projectNames),
        ),
      );
  const chosenProject = projects.find(
    (project) => project.id === filters.projects[0],
  );
  const isEmpty = isDrafts
    ? drafts.length === 0
    : matched.length === 0 && shownOutside.length === 0;
  return (
    <>
      <div className="mb-1 flex shrink-0 items-center gap-1 pl-1 [&_button]:[-webkit-app-region:no-drag]">
        <SearchField
          className="h-8 pl-7 text-[13px] [-webkit-app-region:no-drag] [&>svg]:left-2.5"
          offered={offered}
          onChange={(search) => {
            setFilters({ ...filters, search });
          }}
          onTokensChange={(tags) => {
            setFilters({ ...filters, tags });
          }}
          placeholder={
            filters.place === "drafts"
              ? "Search Drafts"
              : filters.place === "archived"
                ? "Search Archived"
                : "Search chats"
          }
          tokens={TAGS.filter((tag) => filters.tags.includes(tag.id))}
          value={filters.search}
        />
        <ViewButton
          className="size-8"
          densityAtom={sidePanelRowDensityAtom}
          hasDayHeadings={false}
        />
      </div>
      <div
        aria-label="Filters"
        className="mb-1.5 flex shrink-0 items-center gap-1 pl-1 [-webkit-app-region:no-drag]"
        role="group"
      >
        {PLACES.map((place) => {
          const isOn = filters.place === place.id;
          return (
            <button
              aria-pressed={isOn}
              className={cn(
                "flex h-7 shrink-0 cursor-default items-center rounded-md px-2 text-[13px]",
                isOn
                  ? "bg-foreground/10 font-medium text-foreground"
                  : "bg-foreground/4 text-foreground/65 hover:bg-foreground/7 hover:text-foreground",
              )}
              key={place.id}
              onClick={() => {
                setFilters(withPlace(filters, isOn ? undefined : place.id));
              }}
              type="button"
            >
              {place.label}
            </button>
          );
        })}
        <span className="flex-1" />
        <ProjectFilter
          chosen={filters.projects[0]}
          onPick={(id) => {
            setFilters({ ...filters, projects: id === undefined ? [] : [id] });
          }}
          projects={projects}
        />
      </div>
      <PanelScroll>
        {isEmpty ? (
          <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
            {emptyLineFor(filters, chats.length, chosenProject)}
          </p>
        ) : isDrafts ? (
          drafts.map((draft) => (
            <DraftRow
              draft={draft}
              key={draft.id}
              now={now}
              onDelete={() => {
                shell.discardDraft(draft.id);
              }}
              onOpen={() => {
                void keepDraft([{ id: draft.id, type: "keep" }]);
                shell.showDraft(draft.id, () => {
                  open(newChatHref(draft.id));
                });
              }}
              projects={projects}
            />
          ))
        ) : (
          <ChatRows
            chats={matched}
            density={density}
            group={group}
            open={open}
          />
        )}
        {outside.length > 0 && shownOutside.length === 0 && (
          <div className="my-1 flex shrink-0 items-center gap-2 px-2">
            <span className="h-px flex-1 bg-foreground/10" />
            <button
              className="flex h-6 cursor-default items-center rounded-full bg-foreground/5 px-2.5 text-xs text-foreground/70 hover:bg-foreground/8 hover:text-foreground"
              onClick={() => {
                setWidenedIn(viewKey);
              }}
              type="button"
            >
              {outside.length} more outside this filter
            </button>
            <span className="h-px flex-1 bg-foreground/10" />
          </div>
        )}
        {shownOutside.length > 0 && (
          <>
            <Heading>Outside this filter</Heading>
            <ChatRows
              chats={shownOutside}
              density={density}
              group={group}
              open={open}
            />
          </>
        )}
      </PanelScroll>
    </>
  );
}

/** Drafts and Archived, the places a chat can be apart from the rest, as the panel's filter row names them. */
const PLACES: { id: ChatPlace; label: string }[] = [
  { id: "drafts", label: "Drafts" },
  { id: "archived", label: "Archived" },
];

/**
 * The filters standing in `place`, or in none: the project and the search
 * stay, and the marks too, except in Drafts, where a draft carries neither.
 */
function withPlace(
  filters: ChatFilters,
  place: ChatPlace | undefined,
): ChatFilters {
  const { place: _place, ...rest } = filters;
  return {
    ...rest,
    ...(place === undefined ? {} : { place }),
    tags: place === "drafts" ? [] : filters.tags,
  };
}

/** The selector's id for every project, which no project has. */
const ALL_PROJECTS = "all";

/**
 * The one project the panel's chats are narrowed to, or none of them, picked
 * from a list that finds a project by name: All projects, each project, then
 * No project for the chats filed under none. The one picked stands in the
 * button in its tint.
 */
function ProjectFilter({
  chosen,
  onPick,
  projects,
}: {
  /** The project picked, `NO_PROJECT` for none; every project without it. */
  chosen: string | undefined;
  onPick: (id: string | undefined) => void;
  projects: Project[];
}) {
  const [isOpen, setOpen] = useState(false);
  const project = projects.find((entry) => entry.id === chosen);
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-7 min-w-0 cursor-default items-center gap-1.5 rounded-md px-2 text-[13px]",
            project
              ? "bg-(--project-tint-surface)/70 font-medium text-(--project-tint-ink) project-tint hover:bg-(--project-tint-surface)"
              : chosen === NO_PROJECT
                ? "bg-foreground/10 font-medium text-foreground"
                : "bg-foreground/4 text-foreground/65 hover:bg-foreground/7 hover:text-foreground data-[state=open]:bg-foreground/10",
          )}
          style={project ? projectTint(projectColor(project)) : undefined}
          type="button"
        >
          {project && <ProjectMark project={project} />}
          <span className="min-w-0 truncate">
            {project?.name ??
              (chosen === NO_PROJECT ? "No project" : "All projects")}
          </span>
          <CaretDownIcon className="size-3 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-60 flex-col p-1"
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        <PickList
          chosen={chosen ?? ALL_PROJECTS}
          entries={[
            {
              icon: <span className="size-3 shrink-0" />,
              id: ALL_PROJECTS,
              isNone: true,
              label: "All projects",
            },
            ...projects
              .filter((entry) => !entry.retired)
              .map((entry) => ({
                icon: <ProjectMark project={entry} />,
                id: entry.id,
                label: entry.name,
              })),
            { icon: <NoProjectMark />, id: NO_PROJECT, label: "No project" },
          ]}
          findPlaceholder="Find a project"
          onPick={(id) => {
            onPick(id === ALL_PROJECTS ? undefined : id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The places of this group's Files sidebar, its project's folder first where it has one. */
function FilesSection({
  group,
  onAll,
  open,
}: {
  group: string;
  onAll: () => void;
  open: OpenAddress;
}) {
  const { places, project } = useFilesPlaces(group);
  const shown = project ? [project, ...places] : places;
  if (shown.length === 0) {
    return null;
  }
  return (
    <>
      <Heading opens={{ onClick: onAll }}>Files</Heading>
      {shown.map((place) => (
        <PlaceRow key={place.path} open={open} place={place} />
      ))}
    </>
  );
}

/**
 * The computer from the top, as Files' This Mac has it: the person's own
 * folders, the disks, and the folders cloud services keep in step.
 */
function ComputerPlaces({ open }: { open: OpenAddress }) {
  const places = useQuery(
    rpcClient.workspace.computer.places.queryOptions(),
  ).data;
  const drives = useQuery(rpcClient.workspace.computer.drives.queryOptions());
  const home = window.api.homeDir;
  // A folder wears the mark the Files places above wear, the home its house.
  const rows = (
    list: { name: string; path: string }[],
    icon: ReactNode | undefined,
  ) =>
    list.map((each) => (
      <PlaceRow
        key={each.path}
        open={open}
        place={{
          icon:
            each.path === home ? (
              <HouseIcon className="size-4" />
            ) : (
              (icon ?? <FolderMark path={each.path} size="large" />)
            ),
          name: each.name,
          path: each.path,
        }}
      />
    ));
  return (
    <PanelScroll>
      <Heading>Folders</Heading>
      {rows(
        (places?.favorites ?? []).filter(
          (place) => place.kind === "home" || place.kind === "folder",
        ),
        undefined,
      )}
      {drives.data && drives.data.length > 0 && (
        <>
          <Heading>Drives</Heading>
          {rows(drives.data, <HardDriveIcon className="size-4" />)}
        </>
      )}
      {places?.volumes.some((volume) => volume.kind === "cloud") && (
        <>
          <Heading>Cloud storage</Heading>
          {rows(
            places.volumes.filter((volume) => volume.kind === "cloud"),
            <CloudIcon className="size-4" />,
          )}
        </>
      )}
    </PanelScroll>
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
          <CopyIcon className="size-4" />
          <span>Copy Path</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The bookmarks bar as a folder, then the bookmarks kept off the bar, the
 * first few, with All bookmarks after them while more are kept. What is held
 * over All bookmarks, or over the heading while there is no such row, is
 * filed at the end of All Bookmarks.
 */
function BookmarksSection({
  onAll,
  open,
}: {
  onAll: () => void;
  open: OpenAddress;
}) {
  const state = useAtomValue(bookmarksStateAtom);
  const others = rootItems(state, OTHER_ROOT).length;
  const isEmpty = barItems(state).length === 0 && others === 0;
  const hasMore = others > BOOKMARKS_SHOWN;
  const heading = <Heading opens={{ onClick: onAll }}>Bookmarks</Heading>;
  return (
    <>
      {isEmpty || hasMore ? (
        heading
      ) : (
        <AllBookmarksDrop className="not-first:mt-2">
          {(className) => (
            <div className={cn("rounded-lg", className)}>{heading}</div>
          )}
        </AllBookmarksDrop>
      )}
      {isEmpty ? (
        <AllBookmarksDrop>
          {(className) => (
            <p className={cn(EMPTY_SLOT, className)}>
              <BookmarksIcon className="size-4 shrink-0" />
              Bookmarks you keep show up here.
            </p>
          )}
        </AllBookmarksDrop>
      ) : (
        <>
          <BookmarkTree open={open} othersShown={BOOKMARKS_SHOWN} />
          {hasMore && (
            <AllBookmarksDrop>
              {(className) => (
                <MoreRow
                  className={className}
                  label="All bookmarks"
                  onClick={onAll}
                />
              )}
            </AllBookmarksDrop>
          )}
        </>
      )}
    </>
  );
}

/** All Bookmarks as a place to drop on, ringed while what is held would go there. */
const ALL_BOOKMARKS_ROW = ":all";

/**
 * What files what is held at the end of All Bookmarks (`useAllBookmarksTarget`):
 * the All bookmarks row, the section's heading, or the empty list's line.
 * `children` draws it, given the ring while a drop would land there.
 */
function AllBookmarksDrop({
  children,
  className,
}: {
  children: (className: string | undefined) => ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useAllBookmarksTarget({ area: () => ref.current, id: ALL_BOOKMARKS_ROW });
  const drop = useOutlineDrop();
  return (
    <div className={className} ref={ref}>
      {children(drop.row?.id === ALL_BOOKMARKS_ROW ? DROP_TONE : undefined)}
    </div>
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

/** The rows inside the folder or bar `id`, at any depth, as they stand under it. */
function rowsUnder(rows: PanelRow[], id: string | undefined): Set<string> {
  const under = new Set<string>();
  const at = rows.findIndex((row) => row.id === id);
  const head = rows[at];
  if (!head) {
    return under;
  }
  const depthOf = (row: PanelRow) => (row.kind === "bar" ? 0 : row.depth);
  for (const row of rows.slice(at + 1)) {
    if (depthOf(row) <= depthOf(head)) {
      break;
    }
    under.add(row.id);
  }
  return under;
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
  // The folder just opened, whose rows grow in.
  const [opened, setOpened] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const rows = panelRows(state, isOpen, othersShown);
  const growing = rowsUnder(rows, opened);
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
      setOpened(id);
    }
    setOpen(next);
  };
  return (
    <>
      <div
        className="flex flex-col"
        // Grown in, the rows stop clipping, so a drop's line shows past them.
        onAnimationEnd={(event) => {
          if (event.animationName === "row-open") {
            setOpened(undefined);
          }
        }}
        ref={list}
      >
        {rows.map((row) => {
          const at = drop.row?.id === row.id ? drop.row.at : undefined;
          const marks = {
            className: cn(
              ROW,
              "relative",
              growing.has(row.id) &&
                "animate-[row-open_160ms_ease-out_backwards] overflow-hidden motion-reduce:animate-none",
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
                    <BookmarksIcon className="size-4 shrink-0 text-foreground/70" />
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
                title={bookmark.url}
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
