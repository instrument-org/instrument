import { undoOnShow } from "@/client/lib/undo-toast";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { useLatest } from "@/client/hooks/use-latest";
import { useIsNarrower } from "@/client/hooks/use-is-narrower";
import { type ChosenItem } from "@/shared/drafts";
import {
  computerColumnWidthAtom,
  type ComputerFolderView,
  computerFolderViewsAtom,
  computerHiddenFilesAtom,
  computerListColumnsAtom,
  computerListColumnWidthsAtom,
  computerOpenFoldersAtom,
  computerViewAtom,
  type FileTab,
  filesCutAtom,
  finderPlacesOpenAtom,
  finderPlacesWidthAtom,
} from "@/client/atoms/window";
import { windowHoldsAtom } from "@/client/atoms/tab-navigation-block";
import {
  FileSystem,
  type FileSystemFileItem,
  itemKindLabel,
  type FileSystemHandle,
  type FileSystemItem,
  type FileSystemGroupKey,
  type FileSystemSortState,
  type FileSystemView,
} from "@/client/components/extend/file-system";
import { isQuickLookPress } from "@/client/components/extend/file-system-keys";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { useTheme } from "@/client/components/theme-provider";
import { Button } from "@/client/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { Spinner } from "@/client/components/ui/spinner";
import {
  refreshWhileShown,
  useIsActiveTab,
} from "@/client/hooks/use-active-tab";
import { computerFolderOptions } from "@/client/lib/live-computer-folder";
import { useRecentFiles } from "@/client/hooks/use-recent-files";
import {
  useBookmarkRow,
  useWindowPlaces,
} from "@/client/hooks/use-open-target";
import { fileAddressOf } from "@/client/bookmarks/address";
import { keptPathsAtom } from "@/client/bookmarks/store";
import { getFileType, opensInSystemApp } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import {
  endOwnFileDrag,
  isOwnFileDragOf,
  isSelfFileDrag,
  ownFileDragInAir,
  sawOwnFileDrag,
  releaseSelfFileDrag,
} from "@/client/lib/self-file-drag";
import {
  cn,
  commandKeyHeld,
  currentOs,
  isMacOS,
  osConventions,
} from "@/client/lib/utils";
import { useWorkspaceFolder } from "@/client/lib/output-folder";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  COMPUTER_ROOT,
  fileHref,
  folderHref,
  RECENTS_ROOT,
} from "@/shared/computer-href";
import { keptInPlaceReason } from "@/shared/instrument-folders";
import { NO_FAVORITE_CHANGES, favoritePlaces } from "@/shared/favorite-places";
import { expandHomePath, folderNameFromPath } from "@instrument-org/shared";
import {
  type BrowserTargetId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { FileDashedIcon } from "@phosphor-icons/react/FileDashed";
import { FolderDashedIcon } from "@phosphor-icons/react/FolderDashed";
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import {
  getDefaultStore,
  useAtom,
  useAtomValue,
  useSetAtom,
  useStore,
} from "jotai";
import ms from "ms";
import { unique } from "radashi";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "@/client/lib/toast";
import {
  drivePage,
  giveKeyboardTo,
  onPageEdge,
  pageHasLayer,
} from "@/client/lib/browser-pool";
import { pictureHoldingKeyboard } from "@/client/lib/picture-keys";

import { openInNewWindow } from "./app-tabs";
import { useWindow } from "./context";
import { DROP_LOOK } from "./drag/tone";
import { filesOfDrop } from "./drag/held-tabs";
import { arrivalView } from "./files-step";
import { useGroupTab } from "./group-tab";
import { dragAtom } from "./drag/session";
import { maySpring, SPRING_FLASH_MS, springTimer } from "./spring-loading";
import { type GoFiles } from "./use-files-step";
import { FileThumbnail } from "./file-thumbnail";
import { ComputerOverview } from "./computer-overview";
import { type FileInfoItem, TITLED_NAME } from "./file-info";
import { lookPathOf, type LookTarget } from "./look-at";
import { FolderNameMenu } from "./folder-name-menu";
import {
  folderOf,
  homeRelative,
  isInside,
  joinHostPath,
  nameOf,
  parentFolderOf,
  relativeHostPath,
  segmentsOf,
} from "./host-path";
import { useClashQuestions } from "./clash-dialog";
import { createPasteTarget } from "./paste-target";
import { toastWithUndo, withdrawUndoOffer } from "./undo-offers";

import { FinderPlaces, PlacesToggle, placeMenuOf } from "./finder-places";
import {
  FolderMenu,
  type FolderMenuActions,
  FolderOverflowMenu,
  SORT_BY,
} from "./folder-menu";
import { NotPermitted } from "./not-permitted";
import { combineListings, useListedItems } from "./use-listed-items";
import {
  dropEffectOf,
  fileActionFailed,
  fileTabOf,
  filesToPaste,
  hostPathOfItem,
  placedMessage,
  protectionBlocked,
  refusalLine,
  rowPress,
  undoFailed,
} from "./finder-actions";
/**
 * How many folders' layouts are kept. Past it the one left alone longest goes
 * back to opening the way a folder never set does.
 */
const FOLDER_VIEWS_KEPT = 500;
const OPEN_FOLDERS_KEPT = 500;

/** Below this width, in CSS px (Tailwind's `@xl`), the places stand over the folder rather than beside it. */
const NARROW_FINDER_PX = 576;

/**
 * How narrow and how wide the Finder's sidebar can be dragged, in CSS px,
 * where it opens and goes back to on a double-click at its edge, and how far
 * under its minimum a drag puts it away.
 */
const PLACES_BOUNDS: RailBounds = {
  collapse: 110,
  initial: 176,
  max: 360,
  min: 140,
};

/**
 * How the row's section over the folder moves as a file opens beside it and
 * closes, in step with the folder narrowing under it.
 */
export const BESIDE_MOTION_CLASSNAME =
  "duration-[380ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";

/** A page's width over its height, the shape a document's picture is drawn in. */
const PAGE_ASPECT = 0.78;

/** How often the recent files and the disks are read again, and how long a listing read ahead stays fresh. */
const REFRESH_MS = ms("4 seconds");

export { RECENTS_ROOT };

/** The order a folder never sorted by hand opens in. */
const NAME_SORT: FileSystemSortState = { direction: "asc", key: "name" };

/** The order the recents open in: the most recently opened first. */
const RECENTS_SORT: FileSystemSortState = {
  direction: "desc",
  key: "openedAt",
};

/** The folder the user is looking at, for the conversation. */
export interface FolderOnScreen {
  /** As the person writes it: `~/Documents`. */
  display: string;
  hostPath: string;
  /** How the agent reaches it, when a granted folder covers it. */
  mount?: string;
  /** Names selected in it, a folder's with a trailing slash. */
  selected: string[];
  /** What is selected in it, by host path and kind. */
  selectedItems: ChosenItem[];
  /**
   * As the person walked to it, which is how the location bar names it.
   * Differs from `display` where the folder lives somewhere other than
   * where it is shown: an iCloud Drive app folder.
   */
  walked: string;
}

/**
 * The column edge where the row crosses it: a divider as tall as the
 * controls rather than a line through the row, so the controls line up with
 * the column they act on without the row being cut into cells.
 */
const EDGE_DIVIDER_CLASSNAME =
  "relative after:absolute after:top-1/2 after:right-0 after:h-5 after:w-px after:-translate-y-1/2 after:bg-border after:transition-opacity";

/**
 * This Mac, browsed the way the Finder browses it: a sidebar of the places a
 * person keeps things and every volume, and the folder the browser is rooted
 * in, opened as the app's own user so every folder opens. A folder is shown
 * by showing its contents, the way the Finder's columns do, and nothing
 * beside it; a text file reads in the last column. Where the folder is, and
 * the way back up out of it, is the row above every tab rather than a bar of
 * its own under the columns: the same path twice is one of them wrong.
 *
 * The file browser holds a flat manifest and asks for a folder's children the
 * first time it is opened. Every folder on screen follows its changes
 * (`computerFolderOptions`), so what a task writes shows up as it is
 * written.
 *
 * A tab of its own is where this belongs, and a box on a page is where it also
 * fits: the page that puts it in a box holds the folder it is looking at
 * itself, so walking the folders leaves the tab where it is.
 */
export function ComputerPage({
  arrivals,
  beside,
  go,
  onFolderChange,
  onOpenFile,
  onInfoSelection,
  onInfoShow,
  onQuickLook,
  onQuickLookFollow,
  path,
  query,
  quickLookOpen = false,
  refreshInterval = REFRESH_MS,
  root,
  select,
  toolsInRow = false,
  view,
}: {
  /** How many times the tab's address has moved on its own (`useFilesStep`). */
  arrivals: number;
  /**
   * A file open beside the folder, which narrows to `width` with its places
   * put away and its controls in the row's section over it, behind `toggle`.
   * `isClosing` while the file slides away: the places and the row are the
   * folder's again, and the views keep their narrowed layout until the
   * folder has its width back.
   */
  beside?: {
    isClosing: boolean;
    isFolderShown: boolean;
    isResizing: boolean;
    /** The file showing beside the folder, as a path under the root, for its row's mark. */
    openPath?: string;
    /** Everything picked, a folder the columns stand in included, whenever it changes. */
    onPick: (picked: ChosenItem[]) => void;
    /**
     * The page the file is shown as, for a page's file: → on the file puts
     * the keyboard in it, and an up or down arrow it has no use for walks
     * the folder to the file before or after, the keyboard staying in the
     * page that file shows as.
     */
    page?: BrowserTargetId;
    /** Where Ask and the menu for several picked go, in the file's section of the row. */
    pickedInto: HTMLElement | null;
    toggle: ReactNode;
    width: number;
  };
  /** Moves the tab: every change to where it stands goes through here. */
  go: GoFiles;
  /** Told the folder on screen whenever it changes; null when nothing on screen is a folder. */
  onFolderChange?: (folder: FolderOnScreen | null) => void;
  /** A file the user opened, when a granted folder covers it. */
  onOpenFile: (file: FileTab) => void;
  /** What is selected, for the info card to follow. */
  onInfoSelection?: (items: FileInfoItem[]) => void;
  /** The info card up over what a menu was opened on. */
  onInfoShow?: (items: FileInfoItem[]) => void;
  /** The selected file, on Space. Left out, Space is not watched for at all. */
  onQuickLook?: (target: LookTarget, from?: () => Element | null) => void;
  /** The file the selection moved to while Quick Look is up, for it to show. */
  onQuickLookFollow?: (target: LookTarget, from?: () => Element | null) => void;
  path: string;
  /** What the folder is searched for: this step's search. */
  query?: string;
  /** Whether Quick Look is up: the arrows then move the selection under it. */
  quickLookOpen?: boolean;
  /**
   * How often the recent files and the disks are read again; false to read
   * them once. The folders on screen follow their changes instead.
   */
  refreshInterval?: false | number;
  root: string;
  /** What is selected in this step, as a path under the root: a file shown in its folder, the file open beside it. */
  select?: string;
  /** Whether the folder's controls go in the tab's row, in a tab of the window's own, rather than a header of their own. */
  toolsInRow?: boolean;
  /** The layout this step of the tab's history shows the folder in. */
  view: FileSystemView;
}) {
  const { openScreen, rowLead, rowTail } = useWindow();
  const placesOf = useWindowPlaces();
  const bookmarkRow = useBookmarkRow();
  const keptPaths = useAtomValue(keptPathsAtom);
  const isBesideOpen = beside !== undefined && !beside.isClosing;
  const [rowTools, setRowTools] = useState<HTMLElement | null>(null);
  // The folder's search, beside a file, takes the room its name stands in.
  const [searchNeedsRoom, setSearchNeedsRoom] = useState(false);
  const placesWidth = useAtomValue(finderPlacesWidthAtom);
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  // Held above the browser, which is rebuilt on every opening, so the column
  // width and the dotfiles answer survive walking into the next folder. The
  // layout and order are kept per folder, below; this is the layout a folder
  // of no layout of its own opens in when arrived at directly.
  const setDefaultView = useSetAtom(computerViewAtom);
  const [folderViews, setFolderViews] = useAtom(computerFolderViewsAtom);
  const [openFolderPaths, setOpenFolderPaths] = useAtom(
    computerOpenFoldersAtom,
  );
  const [columnWidth, setColumnWidth] = useAtom(computerColumnWidthAtom);
  const [listColumns, setListColumns] = useAtom(computerListColumnsAtom);
  const [listColumnWidths, setListColumnWidths] = useAtom(
    computerListColumnWidthsAtom,
  );
  const [showHiddenFiles, setShowHiddenFiles] = useAtom(
    computerHiddenFilesAtom,
  );
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const workspaceFolder = useWorkspaceFolder();
  const keptInPlace = useKeptInPlace();
  // The recents stand where a root folder stands, and are listed the way a
  // folder is, so everything the browser does to a folder it does to them.
  const isRecents = root === RECENTS_ROOT;
  // The disks stand where a root folder stands too, and are no folder.
  const isComputer = root === COMPUTER_ROOT;
  const isFolderless = isRecents || isComputer;
  const recents = useRecentFiles({
    enabled: isRecents,
    refetchInterval: refreshInterval,
  });
  const homePath = window.api.homeDir;
  const preferences = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const favoriteChanges =
    preferences.data?.favoriteChanges ?? NO_FAVORITE_CHANGES;
  const sidebarChangeFailed = () => {
    toast.error("Couldn't change the sidebar");
  };
  // The Instrument folder stands with Recents, as the app's own, and the rest
  // of the defaults under Favorites with whatever the person added.
  const instrumentPlace = places.data?.favorites.find(
    (place) => place.kind === "output",
  );
  const instrumentPath = instrumentPlace?.path;
  const favorites = favoritePlaces(
    (places.data?.favorites ?? []).filter((place) => place !== instrumentPlace),
    favoriteChanges,
    (place) => ({
      kind: "folder" as const,
      name: folderNameFromPath(place),
      path: place,
    }),
  );
  // Folder prefixes under the root whose listings are held, root first. The
  // browser asks for a folder's children only once the folder is in its
  // index, so the folder it opens on needs every folder above it listed. The
  // root they are under is held with them: a prefix means nothing without it,
  // and reading the two apart asked the other computer for `~/Downloads`'s
  // folders under `~/Documents` for the render before the effect caught up.
  const [loaded, setLoaded] = useState<{
    prefixes: readonly string[];
    root: string;
  }>(() => ({ prefixes: prefixesOf(path), root }));
  // A folder arriving takes its own listing and every one above it, held
  // with the rest under the same root.
  const isLoaded =
    loaded.root === root &&
    prefixesOf(path).every((prefix) => loaded.prefixes.includes(prefix));
  if (!isLoaded) {
    setLoaded((previous) => ({
      prefixes:
        previous.root === root
          ? unique([...previous.prefixes, ...prefixesOf(path)])
          : prefixesOf(path),
      root,
    }));
  }
  const prefixes = loaded.root === root ? loaded.prefixes : prefixesOf(path);
  // The folder the browser lists from, as it last said, with the root it said
  // it under: the step's folder, or in the columns the first of them.
  const [listedFrom, setListedFrom] = useState({ path, root });
  const current = listedFrom.root === root ? listedFrom.path : path;
  // The path rather than the item: the items are rebuilt on every re-read,
  // and a selection held as one of them would change with each. The step
  // holds it, so back to a folder finds selected what was left selected.
  const selectedPath = select ?? null;
  const setSelectedPath = (next: null | string) => {
    go({ path: next, type: "select" });
  };
  // Everything selected, when a ⌘- or Shift-click made it several. It stands
  // while it holds `selectedPath`, the one the keyboard is on: the page moving
  // the selection itself, onto a thing just made or renamed, moves it to one.
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const allSelectedPaths =
    selectedPath === null
      ? []
      : selectedPaths.includes(selectedPath)
        ? selectedPaths
        : [selectedPath];

  // `~` names the home folder, which the workspace expands for a folder it is
  // being asked to read. Nothing else does: a path this hands to an action
  // reaches the filesystem as it is, so those pass the expanded root instead.
  // The browser's own prefixes are written with slashes whatever computer this
  // is, so the names are taken out of one and spelled the way the root is.
  const hostPathOf = (prefix: string, base = root) =>
    joinHostPath(base, prefix);

  // What the folder's own menu is open on. Nothing means the menu came up on
  // the folder's empty space, where the things to do are to the folder.
  const [menuItem, setMenuItem] = useState<FileSystemItem>();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // What a menu item asked for that needs the keyboard, done once the menu
  // has let go of it. A closing menu keeps it for as long as it takes to fade
  // out, so a name field opened any sooner lost it at once, and a field that
  // loses the keyboard with its name unchanged closes.
  const afterMenu = useRef<(() => void) | null>(null);
  // The browser itself, asked to type over a name where it sits.
  const fileSystemRef = useRef<FileSystemHandle>(null);

  // Each folder on screen stays current while its tab is up. Tabs behind the
  // one up stay mounted, so their listings stop following the folder there,
  // and coming back up reads them again at once.
  const { enabled: whileShown } = refreshWhileShown(useIsActiveTab(), false);
  const listings = useQueries({
    combine: combineListings,
    queries: isFolderless
      ? []
      : prefixes.map((prefix) => ({
          ...computerFolderOptions(
            { id: WINDOW_ID, path: hostPathOf(prefix) },
            { follow: true },
          ),
          enabled: whileShown,
        })),
  });
  // The folders not yet read the first time, which the browser shows as
  // loading rather than as empty: a slow disk is not an empty one.
  const pendingFolders = new Set(
    isRecents
      ? recents.isPending
        ? [""]
        : []
      : prefixes.filter(
          (_prefix, index) => listings[index]?.isPending === true,
        ),
  );
  // A folder that has gone (thrown away here, moved in the Finder) ends its
  // listing with a failed read, and is let go of. Opening it again brings it
  // back. A folder the system refused is an answer rather than a failure, and
  // is kept: the main process reads a refused folder again every few seconds,
  // which is what fills it the moment the refusal is undone.
  const goneFolder = prefixes.find(
    (prefix, index) => prefix !== "" && listings[index]?.isError === true,
  );
  // The refusal the operating system gave for a folder, by its prefix.
  // Unknown until the folder has been read once, which the browser shows as
  // loading meanwhile.
  const refusalOf = (prefix: string) =>
    listings[prefixes.indexOf(prefix)]?.refusal;
  useEffect(() => {
    if (goneFolder === undefined) {
      return;
    }
    setLoaded((previous) => ({
      ...previous,
      prefixes: previous.prefixes.filter(
        (prefix) => !prefix.startsWith(goneFolder),
      ),
    }));
  }, [goneFolder]);
  const recentEntries = recents.files;
  const { items, recentKeys } = useListedItems({
    instrumentPath,
    isRecents,
    listings,
    prefixes,
    recentEntries,
    resolvedTheme,
    showHiddenFiles,
    workspaceFolder,
  });
  // Listed as files and opened as one, but folders inside, which the menu's
  // Show Package Contents goes into.
  const packagePaths = new Set(
    listings.flatMap(({ data }) =>
      (data?.entries ?? []).flatMap((entry) =>
        entry.package ? [entry.path] : [],
      ),
    ),
  );
  const itemsByPath = new Map(items.map((item) => [item.path, item]));
  // The folders the list shows opened in place: every one listed here that
  // was left open anywhere. The recents open nothing.
  const openFolderSet = new Set(openFolderPaths);
  const openFolders = new Set(
    items.flatMap((item) =>
      item.kind === "folder" && openFolderSet.has(hostPathOfItem(item))
        ? [item.path]
        : [],
    ),
  );
  const changeOpenFolder = (folderPath: string, open: boolean) => {
    const hostPath = hostPathOfItem(itemsByPath.get(folderPath));
    if (!hostPath) {
      return;
    }
    // Newest last, so the oldest are the ones let go of past the cap.
    setOpenFolderPaths((previous) =>
      [
        ...previous.filter((kept) => kept !== hostPath),
        ...(open ? [hostPath] : []),
      ].slice(-OPEN_FOLDERS_KEPT),
    );
  };
  const selectedItem =
    selectedPath === null ? undefined : itemsByPath.get(selectedPath);
  const selectedItems = allSelectedPaths.flatMap((selected) => {
    const item = itemsByPath.get(selected);
    return item ? [item] : [];
  });
  // The recent file the selection is on, which is what stands for a folder on
  // a list of files from all over: it is the only place there is to be.
  const selectedRecent =
    isRecents && selectedPath !== null
      ? recentEntries[recentKeys.indexOf(selectedPath)]
      : undefined;

  // The listings follow their folders, but a folder the user just changed
  // should not wait for its change to be heard.
  const reread = () => {
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.computer.list.key(),
    });
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.computer.describe.key(),
    });
  };

  const browserRef = useRef<HTMLDivElement>(null);
  // Where the keyboard goes when an action is over and the row it acted on is
  // being rebuilt: the browser itself, which the arrows walk the folder from.
  const focusBrowser = () => {
    browserRef.current
      ?.querySelector<HTMLElement>('[data-slot="file-system"]')
      ?.focus({ preventScroll: true });
  };
  // The keyboard crossing from the places into what the place opened, on the
  // arrow that points that way. The row the listing's single tab stop names
  // takes it and is handed the press, so the same arrow both arrives and
  // moves, the way it does inside the listing. Until the listing has been
  // read there is no row to hand it to, and the browser itself takes it: the
  // next arrow reaches the first row through it.
  const enterListing = () => {
    const row = browserRef.current?.querySelector<HTMLElement>(
      '[role="option"][tabindex="0"]',
    );
    if (!row) {
      focusBrowser();
      return;
    }
    row.focus({ preventScroll: true });
    row.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowRight",
      }),
    );
  };

  // The Finder's own actions on the user's own files. Nothing here is the
  // agent's: these run because the person browsing asked for them, from the
  // folder they are looking at.
  const newFolderIn = async (parent: { hostPath: string; prefix: string }) => {
    let made: { path: string };
    try {
      made = await rpcClient.files.newFolder.call({
        parent: parent.hostPath,
      });
    } catch (error) {
      fileActionFailed("Couldn't make a new folder", error);
      return;
    }
    reread();
    // Made and named in one move, the way the Finder does it: the field
    // opens on the row as soon as the re-read puts the folder there.
    fileSystemRef.current?.startRename(`${parent.prefix}${nameOf(made.path)}/`);
  };
  // A failure is said and thrown on, so the browser opens the name field
  // again with what was typed.
  const rename = async (item: FileSystemItem, name: string) => {
    const hostPath = hostPathOfItem(item);
    if (!hostPath) {
      throw new Error("Nothing on this computer to rename");
    }
    const shownName = item.name ?? item.path;
    let renamed: string;
    try {
      ({ path: renamed } = await rpcClient.files.rename.call({
        name,
        path: hostPath,
      }));
    } catch (error) {
      fileActionFailed(`Couldn't rename “${shownName}”`, error);
      throw error;
    }
    // The thing renamed stays selected under its new name, so the column it
    // sits in stays open rather than closing under a selection that has gone;
    // a press elsewhere that put the name field away chose something else,
    // which the step has by the time the rename is written.
    go({
      from: item.path,
      host: { from: hostPath, to: renamed },
      to: siblingPath(item.path, name),
      type: "rename",
    });
    reread();
  };
  const duplicate = async (picked: FileSystemItem[]) => {
    const kept = picked.map(keptInPlace).find(Boolean);
    if (kept) {
      keptInPlaceToast("Couldn't make a copy", kept);
      return;
    }
    const copyEach = async () => {
      for (const item of picked) {
        const hostPath = hostPathOfItem(item);
        if (!hostPath) {
          continue;
        }
        const copy = await rpcClient.files.duplicate.call({ path: hostPath });
        // The copy is what the Finder leaves selected, and where the keyboard
        // carries on from. Several copied leave the several selected.
        if (picked.length === 1) {
          setSelectedPath(siblingPath(item.path, nameOf(copy.path)));
        }
      }
    };
    try {
      await copyEach();
      focusBrowser();
    } catch (error) {
      fileActionFailed("Couldn't make a copy", error);
    }
    reread();
  };
  // Where each thing sits on the Mac, as a terminal, a Finder window or
  // another app takes it, one to a line. The browser's own path names a place
  // inside the browser and is no use anywhere else.
  // The things themselves, as the file manager's Copy puts them on the
  // clipboard, so a paste here or in any other app copies them.
  const store = useStore();
  const copyFiles = async (picked: FileSystemItem[]) => {
    const hostPaths = picked.map(hostPathOfItem).filter(Boolean);
    if (hostPaths.length === 0) {
      return;
    }
    try {
      await rpcClient.files.copyToClipboard.call({ paths: hostPaths });
      store.set(filesCutAtom, []);
      focusBrowser();
    } catch (error) {
      fileActionFailed("Couldn't copy that", error);
    }
  };
  const cutFiles = async (picked: FileSystemItem[]) => {
    const hostPaths = picked.map(hostPathOfItem).filter(Boolean);
    if (hostPaths.length === 0) {
      return;
    }
    const kept = hostPaths.map(keptInPlace).find(Boolean);
    if (kept) {
      keptInPlaceToast("Couldn't move that", kept);
      return;
    }
    try {
      await rpcClient.files.copyToClipboard.call({ paths: hostPaths });
      store.set(filesCutAtom, hostPaths);
      focusBrowser();
    } catch (error) {
      fileActionFailed("Couldn't cut that", error);
    }
  };
  const copyPaths = async (picked: FileSystemItem[]) => {
    const hostPaths = picked.map(hostPathOfItem).filter(Boolean);
    if (hostPaths.length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(hostPaths.join("\n"));
      focusBrowser();
    } catch (error) {
      fileActionFailed("Couldn't copy the path", error);
    }
  };
  const trash = async (picked: FileSystemItem[]) => {
    const hostPaths = picked.map(hostPathOfItem).filter(Boolean);
    if (hostPaths.length === 0) {
      return;
    }
    const kept = hostPaths.map(keptInPlace).find(Boolean);
    if (kept) {
      keptInPlaceToast(
        `Couldn't move that to the ${osConventions().trash}`,
        kept,
      );
      return;
    }
    // Read before they go, while their rows still say what follows them.
    const next =
      fileSystemRef.current?.rowAfter(picked.map((item) => item.path)) ?? null;
    const toTrash = hostPaths;
    // What went, by the journal entries that bring each back: the toast's
    // Undo is about these whatever is done after them.
    const undoable: string[] = [];
    let moved = 0;
    let failed = false;
    try {
      await trashInTurn(toTrash, (journalId) => {
        moved += 1;
        if (journalId !== null) {
          undoable.push(journalId);
        }
      });
    } catch (error) {
      failed = true;
      fileActionFailed(
        `Couldn't move that to the ${osConventions().trash}`,
        error,
      );
    }
    if (!failed) {
      // The row after what went is selected, the way the Finder leaves it,
      // so another press of the key trashes that one too. With nothing
      // after it, the columns open as far as the selection reaches, so they
      // stay in the folder that held what went, with that folder selected.
      const first = picked[0]?.path;
      const holder =
        first === undefined
          ? current
          : first.slice(0, first.lastIndexOf("/", first.length - 2) + 1);
      if (next !== null) {
        fileSystemRef.current?.select([next]);
      } else {
        setSelectedPath(
          view === "columns" && holder !== current ? holder : null,
        );
      }
      focusBrowser();
    }
    reread();
    if (moved > 0) {
      const [only] = toTrash;
      // Offered only when the app found every one of them in the Trash
      // and so can put them all back.
      toastWithUndo(
        moved === 1 && only
          ? `Moved “${segmentsOf(only).at(-1) ?? only}” to the ${osConventions().trash}`
          : `Moved ${moved} items to the ${osConventions().trash}`,
        undoable.length === moved
          ? {
              journalIds: undoable,
              undo: () => {
                void undoJournaled(undoable);
              },
            }
          : null,
      );
    }
  };
  const clashQuestions = useClashQuestions();
  // Copies things into a folder of this computer, as a drop from outside or
  // a paste does, or moves the Finder's own rows there, as a drop of them
  // does. Any name already taken there is asked about first, every one
  // before anything is touched, so stopping leaves everything as it was;
  // then it happens in one go, with one Undo for all of it.
  const placeInto = async (
    mode: "copy" | "move",
    sources: { hostPath: string; isFolder: boolean }[],
    /** The folder, and its prefix under the root where it is under it, as a place of the sidebar may not be. */
    into: { hostPath: string; prefix?: string },
    how: { numbersInPlace?: boolean } = {},
  ) => {
    if (sources.length === 0) {
      return;
    }
    const kept =
      mode === "move"
        ? sources.map((source) => keptInPlace(source.hostPath)).find(Boolean)
        : undefined;
    if (kept) {
      keptInPlaceToast("Couldn't move that", kept);
      return;
    }
    const paths = sources.map((source) => source.hostPath);
    const folderName = nameOf(into.hostPath);
    // What was there already is asked about before anything is put there.
    const askAndPlace = async () => {
      const { clashes } = await rpcClient.files.clashes.call({
        folder: into.hostPath,
        op: mode,
        paths,
      });
      const resolutions =
        clashes.length === 0
          ? {}
          : await clashQuestions.ask(clashes, {
              folder: folderName,
              verb: mode === "move" ? "moving" : "copying",
            });
      if (resolutions === null) {
        return null;
      }
      const route = mode === "move" ? "moveInto" : "copyInto";
      return rpcClient.files[route].call({
        ...how,
        folder: into.hostPath,
        paths,
        // What each Replace was shown in its way, so it replaces only that.
        replacing: Object.fromEntries(
          clashes.flatMap((clash) =>
            resolutions[clash.path] === "replace"
              ? [[clash.path, clash.with.identity]]
              : [],
          ),
        ),
        resolutions,
      });
    };
    let outcome: Awaited<ReturnType<typeof askAndPlace>>;
    try {
      outcome = await askAndPlace();
    } catch (error) {
      fileActionFailed(
        mode === "move" ? "Couldn't move that" : "Couldn't copy that",
        error,
      );
      reread();
      return;
    }
    if (outcome === null) {
      focusBrowser();
      reread();
      return;
    }
    const { failure, journalId, placed, protection, skipped, trashed } =
      outcome;
    const folders = new Set(
      sources.flatMap((source) => (source.isFolder ? [source.hostPath] : [])),
    );
    const { prefix } = into;
    if (prefix !== undefined && prefix === onScreen && placed.length > 0) {
      selectWhenListed(
        placed.map(
          (each) =>
            `${prefix}${nameOf(each.path)}${folders.has(each.from) ? "/" : ""}`,
        ),
      );
    }
    focusBrowser();
    const message = placedMessage({
      folderName,
      placed,
      skipped: skipped.filter((each) => each.why === "answered").length,
    });
    // What a Replace put in the Trash cannot be put back from here, so
    // that toast shows where it went instead of offering Undo. Showing it
    // is the Mac's: the Finder reveals it, or opens the Trash.
    const [firstTrashed] = trashed;
    if (message && firstTrashed) {
      toast(message, {
        action: isMacOS()
          ? {
              label: "Show in Trash",
              onClick: () => {
                void rpcClient.files.showInTrash
                  .call({
                    inTrash: firstTrashed.inTrash,
                  })
                  .catch((error: unknown) => {
                    toast.error("Couldn't show the Trash", { cause: error });
                  });
              },
            }
          : undefined,
      });
    } else if (message) {
      toastWithUndo(
        message,
        journalId === null
          ? null
          : {
              journalIds: [journalId],
              undo: () => {
                void undoJournaled([journalId]);
              },
            },
      );
    }
    // Said apart from what was done, so nothing that stopped short or was
    // passed over goes unmentioned.
    const changed = skipped.filter((each) => each.why === "changed");
    const [first] = changed;
    if (first) {
      toast(
        changed.length === 1
          ? `“${nameOf(first.source)}” changed before it could be put there, so it was left where it was.`
          : `${changed.length.toString()} items changed before they could be put there, so they were left where they were.`,
      );
    }
    const there = skipped.filter((each) => each.why === "already-there");
    const [firstThere] = there;
    if (firstThere) {
      toast(
        there.length === 1
          ? `“${nameOf(firstThere.source)}” is already in “${folderName}”.`
          : `${there.length.toString()} of these are already in “${folderName}”.`,
      );
    }
    if (protection) {
      protectionBlocked(protection);
    } else if (failure) {
      toast.error(
        mode === "move" ? "Couldn't finish moving" : "Couldn't finish copying",
        { description: failure },
      );
    }
    reread();
  };
  const copyInto = (
    sources: { hostPath: string; isFolder: boolean }[],
    into: { hostPath: string; prefix?: string },
    how?: { numbersInPlace?: boolean },
  ) => placeInto("copy", sources, into, how);
  const moveInto = (
    sources: { hostPath: string; isFolder: boolean }[],
    into: { hostPath: string; prefix?: string },
  ) => placeInto("move", sources, into);
  // What a drop just put in the folder on screen, selected once the re-read
  // lists it: until then there is no row to select.
  const selectingWhenListed = useRef<null | readonly string[]>(null);
  const selectWhenListed = (paths: readonly string[]) => {
    selectingWhenListed.current = paths;
  };
  useEffect(() => {
    const paths = selectingWhenListed.current;
    const listed = new Set(items.map((item) => item.path));
    if (paths === null || !paths.every((each) => listed.has(each))) {
      return;
    }
    selectingWhenListed.current = null;
    fileSystemRef.current?.select(paths);
  }, [items]);
  // The toast's Undo: each of them back, the last first, stopping at the
  // first that cannot come back and saying why. One already put back another
  // way, by ⌘Z say, is passed over quietly.
  const undoJournaled = async (journalIds: string[]) => {
    let first: null | RPCOutput["files"]["undo"] = null;
    try {
      await undoInTurn(journalIds, (undone) => {
        withdrawUndoOffer(undone.journalId);
        first = undone;
      });
    } catch (error) {
      fileActionFailed("Couldn't put that back", error);
    }
    reread();
    if (first) {
      selectUndone(first);
    }
  };

  const listingOf = (prefix: string) =>
    listings[prefixes.indexOf(prefix)]?.data;
  // Whether the listings held are the root's: a new root takes its own in
  // the render it arrives in, and nothing is read against the old ones.
  const settled = loaded.root === root;
  // The recents are rooted nowhere, so no place in the list is the one open.
  // A root under `~` is the same folder spelled out below the home folder.
  const rootHostPath = isFolderless
    ? undefined
    : root === "~"
      ? homePath
      : root.startsWith("~/")
        ? homePath && joinHostPath(homePath, root.slice(2))
        : root;
  // The folder the tab is rooted at going ends its listing with a failed
  // read, as a folder under it does, and the listing the cache still holds
  // would go on showing what was in it. The tab stays at it, as a browser
  // tab stays at a page that failed to load, and says so where its contents
  // were, with the way up to the nearest folder above it still there. A read
  // that failed for a folder still there shows what it last listed.
  const isRootUnread = settled && listings[0]?.isError === true;
  const [goneRoot, setGoneRoot] = useState<{ root: string; there: string }>();
  useEffect(() => {
    if (!isRootUnread || !rootHostPath) {
      return;
    }
    let isCurrent = true;
    void nearestFolderThere(rootHostPath)
      .then((there) => {
        if (isCurrent && there !== rootHostPath) {
          setGoneRoot({ root, there });
        }
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [isRootUnread, rootHostPath, root]);
  const isRootNotFound =
    isRootUnread && rootHostPath !== undefined && goneRoot?.root === root;
  // Asked again while it is on screen, so a folder put back shows again.
  const rereadRoot = () => {
    void queryClient.invalidateQueries({
      queryKey: computerFolderOptions({ id: WINDOW_ID, path: hostPathOf("") })
        .queryKey,
    });
  };
  const recheckRoot = useEffectEvent(rereadRoot);
  const isRootNotFoundShown = useIsActiveTab() && isRootNotFound;
  useEffect(() => {
    if (!isRootNotFoundShown) {
      return;
    }
    const timer = setInterval(recheckRoot, ROOT_RECHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isRootNotFoundShown]);
  const rootNotFound =
    isRootNotFound && rootHostPath && goneRoot ? (
      <NotFound
        hostPath={rootHostPath}
        kind="folder"
        onShowFolder={() => {
          go({ path: "", root: goneRoot.there, type: "walk" });
        }}
        onTryAgain={rereadRoot}
      />
    ) : null;

  // The layout and order go the way a Finder window's do. The layout belongs
  // to the tab: walking from folder to folder (a double-click, the columns,
  // back and forward) keeps it, and each step of the tab's history holds the
  // layout it was shown in. Arriving at a folder directly (a place, a new
  // tab, a typed path) is the one time a folder's own layout counts
  // (`arrivalViewOf`). The order belongs to the folder however it is reached,
  // and one never set is by name; the recents are a list of their own and
  // open newest first.
  const folderKeyOf = (prefix: string) => folderViewKey(root, prefix, homePath);
  const currentKey = folderKeyOf(current);
  // The List leads each page with the title it gives itself, read for the
  // files listed while it is the layout, and again for a file once it is
  // written.
  const titledFiles =
    view === "list"
      ? items.filter(
          (item) =>
            item.kind === "file" && TITLED_NAME.test(hostPathOfItem(item)),
        )
      : [];
  const titles = useQuery({
    enabled: titledFiles.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpcClient.workspace.computer.titles.call({
        paths: titledFiles.map(hostPathOfItem),
      }),
    queryKey: [
      "computer-titles",
      titledFiles.map(
        (item) =>
          `${hostPathOfItem(item)}\0${item.kind === "file" ? (item.updatedAt ?? "") : ""}`,
      ),
    ],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const titledItems = titles.data
    ? items.map((item) => {
        const title = titles.data[hostPathOfItem(item)];
        return item.kind === "file" && title ? { ...item, title } : item;
      })
    : items;
  const sortOf = (key: string) =>
    folderViews[key]?.sort ?? (isRecents ? RECENTS_SORT : NAME_SORT);
  const groupOf = (key: string) => folderViews[key]?.group ?? null;
  const [shown, setShown] = useState(() => ({
    at: currentKey,
    group: groupOf(currentKey),
    sort: sortOf(currentKey),
  }));
  // Set during render rather than in an effect, so the folder is drawn in its
  // own order from its first frame. A new root arrives a render ahead of the
  // folder under it, so nothing is taken until the two agree.
  if (settled && shown.at !== currentKey) {
    setShown({
      at: currentKey,
      group: groupOf(currentKey),
      sort: sortOf(currentKey),
    });
  }

  // The folder on screen: the step's own. In the columns a selected folder
  // shows its contents in the next column, so selecting one there is
  // standing in it, and the step moves with it (`nextStep`). Every other
  // layout shows the step's folder whatever is selected in it.
  const onScreen = path;
  const currentListing = listingOf(onScreen);
  // The folder standing on screen, by its path: the listing's own once it has
  // arrived, the root the sidebar resolved until then. The recents are a list
  // rather than a folder, and have none.
  const folderOnScreenPath = isFolderless
    ? undefined
    : (currentListing?.path ?? hostPathOf(onScreen, rootHostPath ?? root));

  // The folder on screen is one the operating system would not let this app
  // read. On a Mac the first read of a protected folder is the system's own
  // ask, so this is what a declined ask looks like, and where it is undone.
  const isCurrentNotPermitted = refusalOf(onScreen) !== undefined;
  // A change is kept for the folder the window is showing. In the columns that
  // is the last column's folder, which is where leaving the columns goes.
  const keepLook = (look: ComputerFolderView) => {
    setShown((previous) => ({
      ...previous,
      group: look.group ?? null,
      sort: look.sort,
    }));
    const key = folderKeyOf(view === "columns" ? onScreen : current);
    // Newest last, so the oldest are the ones let go of past the cap.
    setFolderViews((previous) => {
      const kept: [string, ComputerFolderView][] = [
        ...Object.entries(previous).filter(([at]) => at !== key),
        [key, look],
      ];
      return Object.fromEntries(kept.slice(-FOLDER_VIEWS_KEPT));
    });
  };
  const sortBy = (sort: FileSystemSortState) => {
    keepLook({ group: shown.group, sort, view });
  };
  const groupBy = (group: FileSystemGroupKey | null) => {
    keepLook({ group, sort: shown.sort, view });
  };
  // Files dropped on the folder are copied into it: onto a folder's row, into
  // that folder; onto a file's row, into the folder that lists it; anywhere
  // else, into the folder the pointer is over (a column's own, in the
  // columns). The folder taking it is outlined while the drag is over it,
  // and the Finder takes the drop before anything around it can.
  const [dropInto, setDropInto] = useState<null | string>(null);
  const dropIntoOf = (target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return current;
    }
    const row = target
      .closest("[data-file-system-item]")
      ?.getAttribute("data-file-system-item");
    if (row !== undefined && row !== null) {
      return itemsByPath.get(row)?.kind === "folder"
        ? row
        : row.slice(0, row.lastIndexOf("/", row.length - 2) + 1);
    }
    return (
      target
        .closest("[data-file-system-folder]")
        ?.getAttribute("data-file-system-folder") || current
    );
  };
  // A folder's listing read before it is opened, unless reading it would
  // have macOS ask the person first.
  const readAhead = (prefix: string) => {
    if (isRecents || macosAsksFirst(hostPathOf(prefix))) {
      return;
    }
    void queryClient.prefetchQuery(
      computerFolderOptions(
        { id: WINDOW_ID, path: hostPathOf(prefix) },
        { staleMs: REFRESH_MS },
      ),
    );
  };
  // The folder whose own row or tile a drag is over, if it opens under a
  // drag that rests there (`maySpring`). macOS asks about a guarded folder
  // once, at its top, so one listed inside another it guards, or one read
  // before, opens without a question.
  const springFolderOf = (target: EventTarget | null) => {
    const row =
      target instanceof Element
        ? target
            .closest("[data-file-system-item]")
            ?.getAttribute("data-file-system-item")
        : null;
    if (!row || itemsByPath.get(row)?.kind !== "folder") {
      return null;
    }
    const read = hostPathOf(row);
    const asksFirst =
      macosAsksFirst(read) &&
      !macosAsksFirst(folderOf(read)) &&
      queryClient.getQueryData(
        rpcClient.workspace.computer.list.queryKey({
          input: { id: WINDOW_ID, path: read },
        }),
      ) === undefined;
    return maySpring({
      asksFirst,
      carried: ownFileDragInAir(),
      folder: row,
      hostPath: hostPathOf(row, rootHostPath ?? root),
      onScreen: path,
      refused: refusalOf(row) !== undefined,
    })
      ? row
      : null;
  };
  const isDropOpen = !isRecents && settled;
  const dropHostPathOf = (prefix: string) =>
    hostPathOf(prefix, rootHostPath ?? root);
  const dropHandlers = useSteadyCallbacks({
    copyInto,
    dropHostPathOf,
    dropIntoOf,
    go,
    moveInto,
    readAhead,
    springFolderOf,
  });
  useEffect(() => {
    const browser = browserRef.current;
    if (!browser || !isDropOpen) {
      return;
    }
    let staleTimer: number | undefined;
    const clear = () => {
      window.clearTimeout(staleTimer);
      setDropInto(null);
    };
    // A drag resting on a folder opens it, so the drag can go on into a
    // folder inside it, and so on down. The folders it opened stand in place
    // of the step on screen until the drag ends: dropped here, the tab stays
    // where it dropped, and otherwise it goes back to where the drag began.
    let hasSprung = false;
    // The ring goes out for a moment just before the folder opens.
    let flashUntil = 0;
    const spring = springTimer(
      (folder) => {
        hasSprung = true;
        dropHandlers.go({ path: folder, type: "spring" });
      },
      {
        flash: () => {
          flashUntil = performance.now() + SPRING_FLASH_MS;
          setDropInto(null);
        },
      },
    );
    const endSpring = (dropped: boolean) => {
      spring.stop();
      if (hasSprung) {
        hasSprung = false;
        dropHandlers.go({ dropped, type: "endSpring" });
      }
    };
    // The system owns a drag, from here or from another app, and the page
    // hears no pointer events until it is over. So the first one heard with
    // folders still sprung open is a drag that ended somewhere else.
    const pointerBack = () => {
      endSpring(false);
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const prefix = dropHandlers.dropIntoOf(event.target);
      const into = dropHandlers.dropHostPathOf(prefix);
      const carried = ownFileDragInAir();
      // Files this app is dragging, over the folder they are in already or
      // inside themselves, go nowhere there (the drop below keeps none of
      // them), so the folder offers nothing, unless Option asks for copies.
      const goesNowhere =
        !event.altKey &&
        carried.length > 0 &&
        movableInto(
          carried.map((hostPath) => ({ hostPath })),
          into,
        ).length === 0;
      event.dataTransfer.dropEffect = goesNowhere
        ? "none"
        : dropEffectOf({ altKey: event.altKey, carried, into });
      setDropInto(
        goesNowhere || performance.now() < flashUntil ? null : prefix,
      );
      sawOwnFileDrag();
      const resting = dropHandlers.springFolderOf(event.target);
      if (resting !== null && event.type === "dragenter") {
        dropHandlers.readAhead(resting);
      }
      spring.rest(resting);
      // `dragover` repeats while the drag is over the folder, so its silence
      // means the drag went somewhere this did not hear about.
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(clear, 1000);
    };
    const leave = (event: DragEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !browser.contains(event.relatedTarget)
      ) {
        clear();
      }
      // A folder opening takes the row under the drag away, which is a leave
      // to nowhere with the drag still over the listing.
      const box = browser.getBoundingClientRect();
      const isOver =
        event.clientX > box.left &&
        event.clientX < box.right &&
        event.clientY > box.top &&
        event.clientY < box.bottom;
      if (
        event.relatedTarget instanceof Node
          ? !browser.contains(event.relatedTarget)
          : !isOver
      ) {
        endSpring(false);
      }
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      clear();
      spring.stop();
      hasSprung = false;
      // Dropped in a folder a rest opened, here or on a place of the
      // sidebar, the tab stays there.
      dropHandlers.go({ dropped: true, type: "endSpring" });
      const wasSelfDrag = isSelfFileDrag();
      releaseSelfFileDrag();
      const prefix = dropHandlers.dropIntoOf(event.target);
      const dropped = { hostPath: dropHandlers.dropHostPathOf(prefix), prefix };
      // Read while the drop is being dispatched: the items empty after.
      const sources = filesOfDrop(event.dataTransfer);
      const isRowDrag = isOwnFileDragOf(
        sources.map((source) => source.hostPath),
      );
      endOwnFileDrag();
      const copies = isRowDrag && event.altKey;
      // A folder Option-dragged onto itself is copied beside itself.
      const into =
        copies && sources.some((each) => each.hostPath === dropped.hostPath)
          ? {
              hostPath: folderOf(dropped.hostPath),
              prefix: parentPrefixOf(prefix),
            }
          : dropped;
      // A row of this Finder let go of where it already is, or inside
      // itself, is a drag that went nowhere, as in the Finder, unless Option
      // asks for a copy of it there.
      const kept =
        !copies && (isRowDrag || wasSelfDrag)
          ? movableInto(sources, into.hostPath)
          : sources;
      // The Finder's own rows move, as its own drag does, unless Option is
      // held; everything from outside the app is copied in.
      void (isRowDrag && !event.altKey
        ? dropHandlers.moveInto(kept, into)
        : dropHandlers.copyInto(kept, into, {
            numbersInPlace: copies && isMacOS(),
          }));
    };
    // Where the window takes the drag itself (a page's edge), it never
    // reaches the listing, which would otherwise keep its ring and its rest.
    const drags = getDefaultStore();
    const stopWatching = drags.sub(dragAtom, () => {
      if (drags.get(dragAtom)?.landing) {
        clear();
        spring.rest(null);
      }
    });
    browser.addEventListener("dragenter", over);
    browser.addEventListener("dragover", over);
    browser.addEventListener("dragleave", leave);
    browser.addEventListener("drop", drop);
    window.addEventListener("pointermove", pointerBack, { capture: true });
    window.addEventListener("pointerdown", pointerBack, { capture: true });
    return () => {
      clear();
      spring.stop();
      stopWatching();
      window.removeEventListener("pointermove", pointerBack, {
        capture: true,
      });
      window.removeEventListener("pointerdown", pointerBack, {
        capture: true,
      });
      browser.removeEventListener("dragenter", over);
      browser.removeEventListener("dragover", over);
      browser.removeEventListener("dragleave", leave);
      browser.removeEventListener("drop", drop);
    };
  }, [dropHandlers, isDropOpen]);

  // A paste lands in the folder the keyboard is in: the column it is in, in
  // the columns, and the folder on screen otherwise, or the folder a menu's
  // Paste named. It is heard only while the keyboard is in this Finder and
  // out of any field, since that is the only place the window sends it.
  const [pasteTarget] = useState(() => createPasteTarget());
  const pasteDestination = (
    target: EventTarget | null,
    named?: null | string,
  ) => {
    const prefix =
      named ??
      (target instanceof Element
        ? target
            .closest("[data-file-system-folder]")
            ?.getAttribute("data-file-system-folder")
        : undefined) ??
      current;
    return {
      hostPath: dropHandlers.dropHostPathOf(prefix || current),
      prefix: prefix || current,
    };
  };
  // What the clipboard has, moved rather than copied: ⌥⌘V, or the menu's row.
  const moveClipboardInto = (into: { hostPath: string; prefix: string }) => {
    void rpcClient.files.clipboardFiles
      .call()
      .catch(() => ({ files: [] }))
      .then(({ files }) => {
        store.set(filesCutAtom, []);
        return dropHandlers.moveInto(
          movableInto(filesToPaste(files, []), into.hostPath),
          into,
        );
      });
  };
  // Esc puts a cut down, and the rows go back to how they were.
  const cutPaths = useAtomValue(filesCutAtom);
  const isAnythingCut = cutPaths.length > 0;
  useEffect(() => {
    if (!isAnythingCut) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        store.set(filesCutAtom, []);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isAnythingCut, store]);
  const paste = useEffectEvent((event: ClipboardEvent) => {
    const named = pasteTarget.take();
    if (!event.clipboardData || isTypingTarget(event.target)) {
      return;
    }
    // Read while the paste is being dispatched: the items empty after.
    const pasted = [...event.clipboardData.items].flatMap((item) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      const hostPath = file ? window.api.getFilePath(file) : "";
      return hostPath
        ? [
            {
              hostPath,
              isFolder: item.webkitGetAsEntry()?.isDirectory ?? false,
            },
          ]
        : [];
    });
    event.preventDefault();
    const into = pasteDestination(event.target, named);
    // The page sees only the first of several files the Finder copied, so
    // the computer's own list comes first where there is one.
    void rpcClient.files.clipboardFiles
      .call()
      .catch(() => ({ files: [] }))
      .then(({ files }) => {
        const sources = filesToPaste(files, pasted);
        const cut = store.get(filesCutAtom);
        store.set(filesCutAtom, []);
        return isSamePathSet(
          cut,
          sources.map((source) => source.hostPath),
        )
          ? dropHandlers.moveInto(movableInto(sources, into.hostPath), into)
          : dropHandlers.copyInto(sources, into);
      });
  });
  useEffect(() => {
    const browser = browserRef.current;
    if (!browser || !isDropOpen) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      paste(event);
    };
    browser.addEventListener("paste", onPaste);
    return () => {
      browser.removeEventListener("paste", onPaste);
    };
  }, [isDropOpen]);

  // The arrows work the moment a folder is on screen: the first row takes
  // the keyboard on each opening, or the browser where there is no row, unless
  // the user is typing somewhere.
  const hasRows = items.length > 0;
  // Only the Finder in the window's tab that is up: every tab stays mounted,
  // and one behind another is not where the keyboard is. In a tab group, only
  // on the side with the keyboard.
  const isActiveTab = useIsActiveTab();
  const hasKeyboard = useGroupTab()?.hasKeyboard ?? true;
  // Beside a file, the file has the keyboard: the folder takes it only for an
  // address opened in it, never as the tab comes up or the file opens.
  // An opening is the address moving on its own, or a new root.
  const opening = `${root}#${arrivals}`;
  const focusedOpening = useRef(isBesideOpen ? opening : null);
  useEffect(() => {
    if (
      !isActiveTab ||
      !hasKeyboard ||
      isTypingTarget(document.activeElement)
    ) {
      return;
    }
    if (isBesideOpen && focusedOpening.current === opening) {
      return;
    }
    // A folder with no rows yet, or none at all, still takes a paste.
    if (!hasRows) {
      focusBrowser();
      return;
    }
    focusedOpening.current = opening;
    const row = browserRef.current?.querySelector<HTMLElement>(
      '[role="option"][tabindex="0"]',
    );
    row?.focus({ preventScroll: true });
    // Once per opening, when its rows are first there, or when its tab or
    // its side comes up.
  }, [opening, hasRows, isActiveTab, hasKeyboard, isBesideOpen]);

  // A folder the system refused has no listing to say where it is, so where
  // it is comes from the root and the prefix instead: the tab row and the
  // conversation still name the folder the person is standing in.
  const refusedHostPath = isCurrentNotPermitted
    ? hostPathOf(onScreen, rootHostPath ?? root)
    : undefined;
  // What the conversation is told "this folder" means. At the recents that is
  // where the selected file lives, since the list itself is nowhere; with
  // nothing selected there, there is no folder to name.
  const recentFolder = selectedRecent
    ? folderOf(selectedRecent.path)
    : undefined;
  const display = isRecents
    ? recentFolder && homeRelative(recentFolder, homePath)
    : (currentListing?.display ??
      (refusedHostPath && homeRelative(refusedHostPath, homePath)));
  // Where the person walked to the folder, which is how the location bar
  // names it: an iCloud Drive app folder under iCloud Drive, though it lives
  // in its app's container.
  const walked =
    isRecents || display === undefined
      ? display
      : homeRelative(hostPathOf(onScreen, rootHostPath ?? root), homePath);
  const hostPath = isRecents
    ? recentFolder
    : (currentListing?.path ?? refusedHostPath);
  const mount = isRecents
    ? selectedRecent?.access && folderOf(selectedRecent.access.shellPath)
    : currentListing?.access?.shellPath;
  // Named from the folder on screen: a file in a folder opened in place in
  // the list is that folder's name and its own. The folder the columns are
  // showing is the folder itself rather than something selected in it.
  const selectedOnScreen = selectedItems.flatMap((item) => {
    const name = isRecents
      ? item.name
      : item.path !== onScreen && item.path.startsWith(onScreen)
        ? item.path.slice(onScreen.length).replace(/\/$/, "")
        : undefined;
    const itemHostPath = hostPathOfItem(item);
    return name && itemHostPath
      ? [
          {
            item: { kind: item.kind, path: itemHostPath } satisfies ChosenItem,
            // A folder's name ends in a slash, so a reader of the name alone
            // can tell it from a file's.
            name: item.kind === "folder" ? `${name}/` : name,
          },
        ]
      : [];
  });
  // One value for the selection, so the effect below runs when it changes
  // rather than on every re-read that rebuilds the same rows.
  const selectedKey = JSON.stringify(selectedOnScreen);
  const tellFolder = useEffectEvent(() => {
    // The recents with nothing selected, or a folder not yet read: no folder
    // is on screen, and the one that was is not still the answer.
    if (display === undefined || hostPath === undefined) {
      onFolderChange?.(null);
      return;
    }
    onFolderChange?.({
      display,
      hostPath,
      ...(mount === undefined ? {} : { mount }),
      selected: selectedOnScreen.map(({ name }) => name),
      selectedItems: selectedOnScreen.map(({ item }) => item),
      walked: walked ?? display,
    });
  });
  // The selection by its key: the rows are rebuilt on every re-read.
  useEffect(() => {
    tellFolder();
  }, [display, hostPath, mount, onFolderChange, selectedKey, walked]);
  // The arrows a page beside the folder had no use for walk the folder, and
  // the keyboard goes on into the page the next file shows as.
  const besidePage = isBesideOpen ? beside.page : undefined;
  const keyboardInPage = useRef(false);
  // The screen's own frame, which says whether a key was pressed in the folder.
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (besidePage === undefined) {
      keyboardInPage.current = false;
      return;
    }
    if (keyboardInPage.current) {
      keyboardInPage.current = false;
      giveKeyboardTo(besidePage);
    }
    return onPageEdge(besidePage, (edge) => {
      if (edge === "escape") {
        fileSystemRef.current?.focusSelection();
        return;
      }
      keyboardInPage.current = fileSystemRef.current?.step(edge) === true;
    });
  }, [besidePage]);
  // With the keyboard in the folder, the page beside it is driven from
  // here, the way a remote drives a screen: Space and ⇧Space page through
  // it, and Escape closes what the page has open before it puts the file
  // away. The arrows' share is the listing's (`onArrowBesideFile`). Caught
  // on the way down, ahead of the file's own Escape.
  useEffect(() => {
    if (besidePage === undefined || !isActiveTab) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const inFolder =
        event.target instanceof Node &&
        frameRef.current?.contains(event.target) === true;
      if (
        !inFolder ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      if (event.key === " ") {
        // A space in a name being typed goes on to the folder.
        if (fileSystemRef.current?.isTypingAhead()) {
          return;
        }
        event.preventDefault();
        drivePage(besidePage, { by: event.shiftKey ? -1 : 1, type: "scroll" });
        return;
      }
      if (
        event.key === "Escape" &&
        !event.shiftKey &&
        pageHasLayer(besidePage)
      ) {
        event.preventDefault();
        drivePage(besidePage, { type: "close-layer" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [besidePage, isActiveTab]);
  // Beside a file, everything picked by where it is: the folder on screen
  // leaves out the folder the columns stand in, which is still a pick.
  const pickedBeside = selectedItems.flatMap((item): ChosenItem[] => {
    const itemHostPath = hostPathOfItem(item);
    return itemHostPath ? [{ kind: item.kind, path: itemHostPath }] : [];
  });
  const pickedKey = JSON.stringify(pickedBeside);
  // Told as a file opens beside the folder and as the picks change, and
  // only then: the file beside moving on is not a pick.
  const tellPicked = useEffectEvent(() => {
    beside?.onPick(pickedBeside);
  });
  // The selection by its key: the rows are rebuilt on every re-read.
  useEffect(() => {
    tellPicked();
  }, [isBesideOpen, pickedKey]);

  // A type with no viewer here goes to the app the computer would use, the way
  // a double-click in the system's file manager does: a disk image mounts and
  // shows its window. Where that fails, the tab's card says why and offers
  // what is left.
  //
  // An app is launched too. `opensInSystemApp` holds back what runs the moment
  // it opens, since nothing about such a file says it is a program; an app the
  // Finder lists as one is drawn with its own icon and called an Application,
  // so opening it is asking to run it.
  const handOff = useMutation(rpcClient.utils.openPath.mutationOptions());
  const isApp = (tab: { hostPath: string; name: string }) =>
    /\.app$/i.test(tab.name) && packagePaths.has(tab.hostPath);
  const opensOutside = (tab: { hostPath: string; name: string }) =>
    opensInSystemApp(tab.name) || isApp(tab);
  const openFile = (file: FileSystemFileItem) => {
    const tab = fileTabOf(file);
    if (!tab) {
      return;
    }
    if (opensOutside(tab)) {
      handOff.mutate(
        { filepath: tab.hostPath },
        {
          onError: () => {
            onOpenFile(tab);
          },
        },
      );
      return;
    }
    onOpenFile(tab);
  };

  // Space on a selected file or folder, the way the Finder shows one over
  // everything.
  const quickLookTab = selectedItem ? lookTargetOf(selectedItem) : undefined;
  const quickLookKey = quickLookTab && lookPathOf(quickLookTab);
  const quickLookPress = useEffectEvent((event: KeyboardEvent) => {
    if (!quickLookTab || !onQuickLook) {
      return;
    }
    if (
      !isQuickLookPress(event, currentOs()) ||
      isTypingTarget(event.target) ||
      // A dialog over the folder keeps its own Space.
      getDefaultStore().get(windowHoldsAtom).length > 0
    ) {
      return;
    }
    event.preventDefault();
    onQuickLook(quickLookTab, () => selectedRowIn(browserRef.current));
  });
  const hasQuickLook = quickLookKey !== undefined && onQuickLook !== undefined;
  useEffect(() => {
    // No panel to show one in, no key taken from the rest of the page, and
    // none from a tab that is not up.
    if (!hasQuickLook || !isActiveTab) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      quickLookPress(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hasQuickLook, isActiveTab]);

  // The info card follows the selection, by what it says about each item:
  // the rows are rebuilt on every re-read.
  const infoItems = selectedItems.flatMap(infoItemOf);
  const infoKey = JSON.stringify(infoItems);
  const tellInfo = useEffectEvent(() => {
    onInfoSelection?.(infoItems);
  });
  useEffect(() => {
    tellInfo();
  }, [infoKey, onInfoSelection]);
  useEffect(
    () => () => {
      onInfoSelection?.([]);
    },
    [onInfoSelection],
  );

  // What was put back is selected, when it is under the root on screen now:
  // a toast's Undo can come after a move to another root.
  const rootHostPathRef = useLatest(rootHostPath);
  const selectUndone = (undone: { isFolder: boolean; path: null | string }) => {
    const onScreenRoot = rootHostPathRef.current;
    if (undone.path === null || !onScreenRoot) {
      return;
    }
    const relative = relativeHostPath(onScreenRoot, undone.path);
    if (relative !== null) {
      setSelectedPath(`${relative}${undone.isFolder ? "/" : ""}`);
    }
  };
  // ⌘Z takes back the newest thing the Finder did to the computer's files (a
  // rename, a duplicate, a new folder, a move to the Trash), the way the
  // Finder's own Edit > Undo does. What was put back is selected; what cannot
  // be taken back safely says why. Only while the keyboard is in the folder,
  // or nowhere with no file open beside it: a ⌘Z over a file is the file's.
  const undoPress = useEffectEvent((event: KeyboardEvent) => {
    const inFolder =
      event.target instanceof Node &&
      frameRef.current?.contains(event.target) === true;
    const nowhere = event.target === document.body && !isBesideOpen;
    if (
      event.key.toLowerCase() !== "z" ||
      event.shiftKey ||
      event.altKey ||
      !commandKeyHeld(event) ||
      event.defaultPrevented ||
      isTypingTarget(event.target) ||
      !(inFolder || nowhere) ||
      // A toast showing the key is what the key undoes.
      undoOnShow() !== null
    ) {
      return;
    }
    event.preventDefault();
    void rpcClient.files.undo
      .call()
      .then((undone) => {
        withdrawUndoOffer(undone.journalId);
        reread();
        selectUndone(undone);
      })
      .catch(undoFailed);
  });
  useEffect(() => {
    if (!isActiveTab || isRecents) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      undoPress(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isActiveTab, isRecents]);

  // Quick Look stays up while the arrows walk the folder, and shows whatever
  // the selection lands on. The panel holds the keyboard, so the keys are
  // handed to the browser's selected row, which answers them as its own;
  // only the user's own presses are forwarded, not the copies.
  useEffect(() => {
    if (!quickLookOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.isTrusted ||
        !event.key.startsWith("Arrow") ||
        // A zoomed picture's arrows move around it, and its menu's walk the menu.
        pictureHoldingKeyboard()?.canPan()
      ) {
        return;
      }
      const row = selectedRowIn(browserRef.current);
      if (!row) {
        return;
      }
      event.preventDefault();
      row.dispatchEvent(rowPress(event));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [quickLookOpen]);
  const followQuickLook = useEffectEvent(() => {
    if (quickLookOpen && quickLookTab) {
      onQuickLookFollow?.(quickLookTab, () =>
        selectedRowIn(browserRef.current),
      );
    }
  });
  // The tab is rebuilt with the items on every re-read; its path is its identity.
  useEffect(() => {
    followQuickLook();
  }, [quickLookKey, quickLookOpen, onQuickLookFollow]);

  // In a narrow tab the places stand over the folder rather than beside it,
  // put away until asked for and again once one is chosen. A wide one keeps
  // them beside it unless they were put away, which every Finder remembers.
  const [isPlacesOpen, setPlacesOpen] = useState(false);
  const [isPlacesShown, setPlacesShown] = useAtom(finderPlacesOpenAtom);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  // Narrowed beside a file the folder is as wide as it was before it, so
  // the places slide away and back rather than standing over it.
  // Measured, since the toggle that answers to it is drawn in the tab's
  // row, outside the container.
  const isFrameNarrow = useIsNarrower(frame, NARROW_FINDER_PX);
  const [wasNarrow, setWasNarrow] = useState(isFrameNarrow);
  if (beside === undefined && wasNarrow !== isFrameNarrow) {
    setWasNarrow(isFrameNarrow);
  }
  const isNarrow = beside === undefined ? isFrameNarrow : wasNarrow;
  const placesVisible = isNarrow ? isPlacesOpen : isPlacesShown;
  const placesToggle = (
    <PlacesToggle
      isOpen={placesVisible}
      onToggle={() => {
        if (isNarrow) {
          setPlacesOpen((open) => !open);
        } else {
          setPlacesShown((wasShown) => !wasShown);
        }
      }}
    />
  );
  const rootTo = (folder: string, prefix = "") => {
    setPlacesOpen(false);
    go({
      path: prefix,
      root: folder,
      type: "arrive",
      view: arrivalViewOf(folder, prefix),
    });
  };
  // Up from the top of the tab's tree (⌘↑, or Alt+↑ off the Mac).
  const leaveRoot = () => {
    const above = rootParentSearch(rootHostPath, {
      isDisk: places.data?.volumes.some(
        (volume) => volume.kind === "drive" && volume.path === rootHostPath,
      ),
    });
    // A walk of the tab's own, so it keeps the layout on screen, and a file
    // open beside the folder stays open while it goes up.
    if (above) {
      go({ ...above, type: "walk" });
    }
  };

  // Steady, so the places beside the folder are not drawn again each time
  // the selection moves.
  const placeActions = useSteadyCallbacks({
    openInNewTab: (place: string) => {
      openScreen(folderHref(place), { newTab: true });
    },
    openInNewWindow: (place: string) => {
      openScreen(folderHref(place), { into: "window" });
    },
    rootTo: (folder: string) => {
      rootTo(folder);
    },
    removeFavorite: (place: string) => {
      void rpcClient.preferences.removeFavoritePlace
        .call({ path: place })
        .catch(sidebarChangeFailed);
    },
    dropInto: (
      files: readonly { hostPath: string; isFolder: boolean }[],
      folder: string,
      { copies }: { copies: boolean },
    ) => {
      const into =
        folder === dropHostPathOf(onScreen)
          ? { hostPath: folder, prefix: onScreen }
          : { hostPath: folder };
      void (copies ? copyInto([...files], into) : moveInto([...files], into));
    },
    favoriteAt: (paths: readonly string[], order: readonly string[]) => {
      void Promise.all(
        paths.map((each) =>
          rpcClient.preferences.addFavoritePlace.call({
            order: [...order],
            path: each,
          }),
        ),
      ).catch(sidebarChangeFailed);
    },
    spring: (folder: string | undefined) => {
      go(
        folder === undefined
          ? { dropped: false, type: "endSpring" }
          : {
              path: "",
              root: folder === homePath ? "~" : folder,
              type: "spring",
            },
      );
    },
    springs: (folder: string) => {
      // macOS asks about a guarded folder once, at its top, so one read
      // before opens without a question.
      const asksFirst =
        macosAsksFirst(folder) &&
        queryClient.getQueryData(
          rpcClient.workspace.computer.list.queryKey({
            input: { id: WINDOW_ID, path: folder },
          }),
        ) === undefined;
      return (
        !isRecents &&
        folder !== dropHostPathOf(onScreen) &&
        maySpring({
          asksFirst,
          carried: ownFileDragInAir(),
          folder,
          hostPath: folder,
          onScreen: "",
          refused: false,
        })
      );
    },
  });

  if (!places.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  const placeMenu = (place: string, { isFavorite = false } = {}) =>
    placeMenuOf(place, { actions: placeActions, isFavorite });
  const afterMenuClosed = () => {
    afterMenu.current?.();
    afterMenu.current = null;
  };
  /** What the folder's menus do to a row, or to the folder where there is none. */
  const menuActionsFor = (item: FileSystemItem | undefined) => {
    // A row of several selected stands for all of them, as it does in the
    // Finder's menu.
    const group =
      item &&
      allSelectedPaths.length > 1 &&
      allSelectedPaths.includes(item.path)
        ? selectedItems
        : undefined;
    const picked = group ?? (item ? [item] : []);
    return {
      ...menuActionsForOne(item),
      kept: picked.map(keptInPlace).find(Boolean),
      onCopy: () => void copyFiles(picked),
      onCut: () => void cutFiles(picked),
      onDuplicate: () => void duplicate(picked),
      onInfo:
        onInfoShow && picked.length > 0
          ? () => {
              onInfoShow(picked.flatMap(infoItemOf));
            }
          : undefined,
      onTrash: () => void trash(picked),
      ...(group
        ? {
            onOpen: () => {
              openSeveral(group);
            },
            onOpenInNewTab: () => {
              openInTabs(group, { behind: false });
            },
            onOpenInNewWindow: () => {
              openInWindow(group);
            },
            onAddToBookmarks: undefined,
            onOpenInNewGroup: undefined,
            onOpenInSplit: undefined,
            onQuickLook: undefined,
            onRename: undefined,
            opensOutside: undefined,
            favorite: undefined,
            group,
          }
        : {}),
    };
  };
  // Several opened at once cannot all stand in this tab, so each comes up in
  // a tab of its own: the first in front when they were opened, every one
  // behind this when they were opened in new tabs. A file comes up beside the
  // folder it was chosen in, the way one opened in place does.
  const openInTabs = (
    picked: FileSystemItem[],
    { behind }: { behind: boolean },
  ) => {
    let isFirst = true;
    for (const item of picked) {
      const itemPath = hostPathOfItem(item);
      if (!itemPath) {
        continue;
      }
      openScreen(
        item.kind === "folder"
          ? folderHref(itemPath)
          : fileHref(itemPath, {
              tree: folderOnScreenPath ?? folderOf(itemPath),
            }),
        { behind: behind || !isFirst, newTab: true },
      );
      isFirst = false;
    }
  };
  // Opening in a window of their own: each a tab there, the first up.
  const openInWindow = (picked: FileSystemItem[]) => {
    const hrefs = picked.flatMap((item) => {
      const itemPath = hostPathOfItem(item);
      if (!itemPath) {
        return [];
      }
      return [
        item.kind === "folder"
          ? folderHref(itemPath)
          : fileHref(itemPath, {
              tree: folderOnScreenPath ?? folderOf(itemPath),
            }),
      ];
    });
    if (hrefs.length > 0) {
      void openInNewWindow(...hrefs);
    }
  };
  // Opening several, as a double-click or ⌘O on a selection does: each file
  // goes where opening it alone would, and the rest come up in tabs.
  const openSeveral = (picked: FileSystemItem[]) => {
    const inTabs = picked.filter((item) => {
      const tab = item.kind === "file" ? fileTabOf(item) : undefined;
      if (item.kind === "file" && tab && opensOutside(tab)) {
        openFile(item);
        return false;
      }
      return true;
    });
    openInTabs(inTabs, { behind: false });
  };
  // The places a row opens in that one thing can: across from this tab, a
  // tab group of its own, and a bookmark.
  const placesOfOne = (item: FileSystemItem | undefined) => {
    const itemPath = hostPathOfItem(item);
    if (!item || !itemPath) {
      return {};
    }
    const isFolder = item.kind === "folder";
    const opens = placesOf((options) => {
      openScreen(
        isFolder
          ? folderHref(itemPath)
          : fileHref(itemPath, {
              tree: folderOnScreenPath ?? folderOf(itemPath),
            }),
        options,
      );
    });
    const placed = (id: "openNewGroup" | "openSplit") =>
      opens.find((open) => open.id === id)?.run;
    return {
      onAddToBookmarks: bookmarkRow(async () => ({
        title: segmentsOf(itemPath).at(-1) ?? itemPath,
        url: fileAddressOf(itemPath, { isFolder }),
      })).run,
      onOpenInNewGroup: placed("openNewGroup"),
      onOpenInSplit: placed("openSplit"),
    };
  };
  const menuActionsForOne = (item: FileSystemItem | undefined) => ({
    ...placesOfOne(item),
    opensOutside: ((): FolderMenuActions["opensOutside"] => {
      const tab = item?.kind === "file" ? fileTabOf(item) : undefined;
      if (!tab || !opensOutside(tab)) {
        return undefined;
      }
      return isApp(tab) ? "app" : "file";
    })(),
    onCopyPath: () => void copyPaths(item ? [item] : []),
    paste:
      folderOnScreenPath === undefined
        ? undefined
        : {
            into: segmentsOf(folderOnScreenPath).at(-1) ?? folderOnScreenPath,
            onPaste: () => {
              afterMenu.current = () => {
                focusBrowser();
                pasteTarget.name(onScreen);
                void rpcClient.files.paste.call().catch((error: unknown) => {
                  toast.error("Couldn't paste", { cause: error });
                });
              };
            },
            onMove: () => {
              afterMenu.current = () => {
                focusBrowser();
                moveClipboardInto({
                  hostPath: dropHandlers.dropHostPathOf(onScreen || current),
                  prefix: onScreen || current,
                });
              };
            },
          },
    onNewFolder:
      folderOnScreenPath === undefined
        ? undefined
        : () => {
            void newFolderIn({
              hostPath: folderOnScreenPath,
              prefix: onScreen,
            });
          },
    onOpen: () => {
      if (item?.kind === "file") {
        openFile(item);
      }
    },
    onOpenInNewTab: () => {
      openInTabs(item ? [item] : [], { behind: false });
    },
    onOpenInNewWindow: () => {
      openInWindow(item ? [item] : []);
    },
    onQuickLook: (() => {
      const target = item ? lookTargetOf(item) : undefined;
      return onQuickLook && item && target
        ? () => {
            onQuickLook(
              target,
              () =>
                browserRef.current?.querySelector(
                  `[data-file-system-item="${CSS.escape(item.path)}"]`,
                ) ?? null,
            );
          }
        : undefined;
    })(),
    onShowPackageContents: (() => {
      const packagePath = hostPathOfItem(item);
      return packagePath && packagePaths.has(packagePath)
        ? () => {
            rootTo(packagePath);
          }
        : undefined;
    })(),
    onRename: () => {
      const renaming = item?.path;
      if (renaming === undefined) {
        return;
      }
      afterMenu.current = () => {
        fileSystemRef.current?.startRename(renaming);
      };
    },
    favorite: (() => {
      const folderPath = hostPathOfItem(item);
      if (item?.kind !== "folder" || !folderPath) {
        return undefined;
      }
      const isFavorite = favorites.some((place) => place.path === folderPath);
      return {
        isFavorite,
        onToggle: () =>
          void (
            isFavorite
              ? rpcClient.preferences.removeFavoritePlace
              : rpcClient.preferences.addFavoritePlace
          )
            .call({ path: folderPath })
            .catch(sidebarChangeFailed),
      };
    })(),
    onReveal: () =>
      void rpcClient.utils.showFileInFolder
        .call({ filepath: hostPathOfItem(item) })
        .catch((error: unknown) => {
          fileActionFailed(
            `Couldn't show it in ${osConventions().inFileManager}`,
            error,
          );
        }),
  });
  const rootName = isRecents
    ? "Recents"
    : isComputer
      ? osConventions().computer
      : root === "~"
        ? folderNameFromPath(homePath)
        : (places.data.volumes.find((volume) => volume.path === root)?.name ??
          segmentsOf(root).at(-1) ??
          "Root");
  // The folder on screen, which is the only row the sidebar marks: a place
  // walked down out of is no longer where the user is, so nothing is marked
  // until a folder is one of the places itself.
  const folderHostPath = isFolderless
    ? undefined
    : (currentListing?.path ?? hostPathOf(onScreen, rootHostPath ?? root));
  const onPlacesKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    enterListing();
  };
  // Beside a file the folder's section of the row names it, as a menu of
  // the folders above it and the places. Going to one keeps the file open,
  // as walking there does, and the tab's layout with it: a file open beside
  // a folder with no layout of its own is one just arrived from elsewhere.
  const besideTo = (folder: string) => {
    go({
      path: "",
      root: folder === "" ? RECENTS_ROOT : folder === homePath ? "~" : folder,
      type: "walk",
    });
  };
  const volumeNames = new Map(
    places.data.volumes.map((volume) => [volume.path, volume.name]),
  );
  const folderNameOf = (folder: string) =>
    volumeNames.get(folder) ?? segmentsOf(folder).at(-1) ?? folder;
  const besideFolder =
    folderOnScreenPath === undefined
      ? { name: "Recents", path: "" }
      : { name: folderNameOf(folderOnScreenPath), path: folderOnScreenPath };
  const besideAncestors: { name: string; path: string }[] = [];
  let above =
    folderOnScreenPath === undefined || volumeNames.has(folderOnScreenPath)
      ? null
      : parentFolderOf(folderOnScreenPath);
  while (above !== null) {
    besideAncestors.push({ name: folderNameOf(above), path: above });
    above = volumeNames.has(above) ? null : parentFolderOf(above);
  }
  const besidePlaces = [
    {
      places: [
        { name: "Recents", path: "" },
        ...(instrumentPlace
          ? [{ name: instrumentPlace.name, path: instrumentPlace.path }]
          : []),
      ],
    },
    {
      label: "Favorites",
      places: favorites.map(({ name, path: favoritePath }) => ({
        name,
        path: favoritePath,
      })),
    },
    {
      label: "Locations",
      places: places.data.volumes.map(({ name, path: volumePath }) => ({
        name,
        path: volumePath,
      })),
    },
  ];
  const placeLists = (
    <FinderPlaces
      actions={placeActions}
      defaults={places.data.favorites}
      folderHostPath={folderHostPath}
      homePath={homePath}
      instrumentPlace={instrumentPlace}
      isComputer={isComputer}
      isRecents={isRecents}
      favoriteChanges={favoriteChanges}
      volumes={places.data.volumes}
    />
  );
  return (
    // A container, so the places give the folder their room when the tab is
    // narrow: below it they stand over the folder, behind a toggle at the
    // head of the tab's row.
    <div
      className="@container/finder relative flex h-full min-h-0"
      ref={(element) => {
        frameRef.current = element;
        setFrame(element);
      }}
    >
      {/* At the row's far left where the tab has one, the way a file's tree
          toggle is, and as wide as the places beside the folder so the
          folder's own controls start where the folder does; at the head of
          the toolbar where it does not. In a tab of the window's own the
          folder's controls follow it in a section of the row's own, which
          with a file open beside the folder is as wide as the folder and
          holds them all. The toggle that folds the folder away stands past
          that section's edge, at the head of the file's own part of the
          row, so it belongs to the file and the folder's name keeps the
          room. */}
      {rowLead &&
        (toolsInRow
          ? createPortal(
              <>
                <div
                  // With the folder alone the section takes the row, for the
                  // folder's controls to sit at its right edge.
                  data-fills-row={isBesideOpen ? undefined : true}
                  className={cn(
                    "-ml-1.5 flex h-11 shrink-0 items-center gap-1.5 pl-1.5 transition-[width] [interpolate-size:allow-keywords]",
                    !isBesideOpen && "min-w-0 flex-1",
                    EDGE_DIVIDER_CLASSNAME,
                    BESIDE_MOTION_CLASSNAME,
                    beside?.isResizing && "transition-none",
                    isBesideOpen && beside.isFolderShown
                      ? "pr-2 after:opacity-100"
                      : "after:opacity-0",
                  )}
                  style={{
                    width:
                      isBesideOpen && beside.isFolderShown
                        ? beside.width
                        : "auto",
                  }}
                >
                  {isBesideOpen ? null : (
                    <div
                      // Drawn anew as the tab's width moves the places over
                      // the folder or beside it, so the width that follows
                      // lands at once rather than sliding, the way the
                      // places do.
                      key={isNarrow ? "narrow" : "wide"}
                      className={cn(
                        "flex h-11 shrink-0 items-center transition-[width] [interpolate-size:allow-keywords]",
                        EDGE_DIVIDER_CLASSNAME,
                        BESIDE_MOTION_CLASSNAME,
                        placesVisible && !isNarrow
                          ? "after:opacity-100"
                          : "after:opacity-0",
                      )}
                      style={{
                        // Less the section's own inset, so its edge is the places'.
                        width:
                          placesVisible && !isNarrow ? placesWidth - 6 : "auto",
                      }}
                    >
                      {placesToggle}
                    </div>
                  )}
                  {isBesideOpen && beside.isFolderShown ? (
                    <FolderNameMenu
                      ancestors={besideAncestors}
                      folder={besideFolder}
                      iconOnly={searchNeedsRoom}
                      onGo={besideTo}
                      places={besidePlaces}
                    />
                  ) : null}
                  <div
                    className={cn(
                      "flex min-w-0 items-center",
                      isBesideOpen && !searchNeedsRoom ? "shrink-0" : "flex-1",
                      isBesideOpen && !beside.isFolderShown && "hidden",
                    )}
                    ref={setRowTools}
                  />
                </div>
                {isBesideOpen ? (
                  <div className="flex h-11 shrink-0 items-center pl-1">
                    {beside.toggle}
                  </div>
                ) : null}
              </>,
              rowLead,
            )
          : createPortal(placesToggle, rowLead))}
      {/* Several picked beside a file stand in the file's place, so what acts
          on them goes where the file's own actions were. */}
      {isBesideOpen &&
        beside.pickedInto &&
        selectedItems.length > 1 &&
        createPortal(
          <FolderOverflowMenu
            {...menuActionsFor(selectedItem)}
            item={selectedItem}
            onClosed={afterMenuClosed}
          />,
          beside.pickedInto,
        )}
      {/* Beside the folder the way the window's own rail is: its edge
          drags, an over-drag puts it away, and it slides at its width, away
          while a file is open beside the folder. In a narrow tab it slides
          over the folder instead, and a press outside it puts it away. */}
      <StudioSidebarRail
        bounds={PLACES_BOUNDS}
        handleOn="border"
        isOpen={(isNarrow ? isPlacesOpen : isPlacesShown) && !isBesideOpen}
        isOverlay={isNarrow}
        label="Resize the sidebar"
        onCollapse={() => {
          if (isNarrow) {
            setPlacesOpen(false);
          } else {
            setPlacesShown(false);
          }
        }}
        panelClassName="bg-background"
        widthAtom={finderPlacesWidthAtom}
      >
        <nav
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-fade-y px-2 py-2 text-sm"
          onKeyDown={onPlacesKeyDown}
        >
          {placeLists}
        </nav>
      </StudioSidebarRail>
      {isComputer ? (
        <ComputerOverview
          {...(rowLead
            ? {}
            : {
                header: (
                  <div className="flex h-12 shrink-0 items-center gap-0.5 border-b bg-muted/40 px-2">
                    <span className="flex items-center pr-1">
                      {placesToggle}
                    </span>
                    <span className="ml-1.5 truncate text-sm font-semibold">
                      {rootName}
                    </span>
                  </div>
                ),
              })}
          clouds={places.data.volumes.filter(
            (volume) => volume.kind === "cloud",
          )}
          // The system's own folders as it lists them, not the sidebar as
          // the person has added it.
          folders={places.data.favorites.filter(
            (place) => place.kind === "home" || place.kind === "folder",
          )}
          home={homePath}
          menu={(place) => placeMenu(place)}
          onOpen={(place) => {
            rootTo(place === homePath ? "~" : place);
          }}
          onOpenInNewTab={placeActions.openInNewTab}
          refreshInterval={refreshInterval}
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <ContextMenu onOpenChange={setIsMenuOpen}>
            <ContextMenuTrigger asChild>
              <div
                className="relative min-h-0 flex-1"
                // Files let go here go into the folder, not into tabs
                // (`useSidePagesTarget`).
                {...(isDropOpen
                  ? { "data-file-drop-region": "", "data-folder-drop": "" }
                  : {})}
                // A middle click on a row opens it in a tab of its own, waiting
                // behind, as a browser's does: a double-click is what opens
                // one here, since a single click selects.
                onAuxClick={(event) => {
                  if (
                    event.button !== 1 ||
                    !(event.target instanceof Element)
                  ) {
                    return;
                  }
                  const itemPath = event.target
                    .closest("[data-file-system-item]")
                    ?.getAttribute("data-file-system-item");
                  const item = items.find((entry) => entry.path === itemPath);
                  if (item) {
                    event.preventDefault();
                    openInTabs([item], { behind: true });
                  }
                }}
                // The middle button's own answer is to scroll; here it opens.
                onMouseDown={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                  }
                }}
                ref={browserRef}
              >
                {dropInto === current ? (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-1 z-10 rounded-lg",
                      DROP_LOOK.open,
                    )}
                  />
                ) : null}
                {isAnythingCut ? (
                  // Faded where each view draws its rows, whichever that is.
                  <style>
                    {cutRowsStyle(
                      items.filter((item) =>
                        cutPaths.includes(hostPathOfItem(item)),
                      ),
                    )}
                  </style>
                ) : null}
                <FileSystem
                  className="h-full rounded-none border-0"
                  keyboardHome
                  columnWidth={columnWidth}
                  contextMenuPath={
                    dropInto !== null && dropInto !== current
                      ? dropInto
                      : isMenuOpen
                        ? (menuItem?.path ?? null)
                        : null
                  }
                  {...(currentListing?.truncated
                    ? {
                        partialFolder: {
                          action: {
                            label: `Open in ${osConventions().fileManager}`,
                            onPress: () => {
                              handOff.mutate({ filepath: currentListing.path });
                            },
                          },
                          total: currentListing.total,
                        },
                      }
                    : {})}
                  // Every row here is a thing on this computer, and drags out of
                  // the window as one: to the desktop, a Finder window, another
                  // app. What lands there is the OS's copy; nothing here moves.
                  emptyState={
                    isRecents
                      ? {
                          description:
                            "Files you open in Instrument show up here, so you can get back to them quickly.",
                          title: "No recent files yet",
                        }
                      : undefined
                  }
                  getHostPath={(item) => hostPathOfItem(item) || undefined}
                  {...(keptPaths.size === 0
                    ? {}
                    : {
                        isBookmarked: (item: FileSystemItem) =>
                          keptPaths.has(hostPathOfItem(item)),
                      })}
                  items={titledItems}
                  // A new root is a new browser; a step under the same root
                  // is handed to the one on screen.
                  key={root}
                  listColumns={listColumns}
                  listColumnWidths={listColumnWidths}
                  loadChildren={async ({ path: prefix }) => {
                    // The recents are one flat list of files; nothing on it opens.
                    if (isRecents) {
                      return { items: [] };
                    }
                    setLoaded((previous) =>
                      previous.root === root &&
                      previous.prefixes.includes(prefix)
                        ? previous
                        : {
                            prefixes:
                              previous.root === root
                                ? [...previous.prefixes, prefix]
                                : [...prefixesOf(path), prefix],
                            root,
                          },
                    );
                    // A listing read ahead on hover, and still fresh, shows
                    // at once; the folder's own reader then follows it.
                    await queryClient.fetchQuery(
                      computerFolderOptions(
                        { id: WINDOW_ID, path: hostPathOf(prefix) },
                        { staleMs: REFRESH_MS },
                      ),
                    );
                    // The entries arrive through `items`, kept current above,
                    // so the browser is handed none of its own to hold.
                    return { items: [] };
                  }}
                  // The selection walks the folder under Quick Look, which holds
                  // the keyboard itself: a row taking it back would be taking it
                  // out of the panel the user is looking at.
                  moveFocusWithSelection={!quickLookOpen}
                  onColumnWidthChange={setColumnWidth}
                  onFileOpen={openFile}
                  onOpenSeveral={(several) => {
                    openSeveral(several);
                  }}
                  onItemContextMenu={(item) => {
                    setMenuItem(item ?? undefined);
                  }}
                  onListColumnsChange={setListColumns}
                  onListColumnWidthsChange={setListColumnWidths}
                  path={path}
                  onPathChange={(listed) => {
                    setListedFrom((previous) =>
                      previous.path === listed && previous.root === root
                        ? previous
                        : { path: listed, root },
                    );
                  }}
                  onWalk={(to, selected) => {
                    setSelectedPaths([]);
                    go({
                      path: to,
                      select: selected ?? undefined,
                      type: "walk",
                    });
                  }}
                  onOpenFolderChange={isRecents ? undefined : changeOpenFolder}
                  onRenameCommit={rename}
                  canRenameItem={(item) => keptInPlace(item) === undefined}
                  search={query ?? ""}
                  onSearchChange={(next) => {
                    go({ query: next, type: "search" });
                  }}
                  onSelectionChange={(item, all) => {
                    setSelectedPaths(all.map((each) => each.path));
                    go({
                      path: item?.path ?? null,
                      several: all.length > 1,
                      type: "select",
                    });
                  }}
                  onGroupChange={groupBy}
                  onShowHiddenFilesChange={setShowHiddenFiles}
                  onSortChange={sortBy}
                  onLeaveRoot={isRecents ? undefined : leaveRoot}
                  {...(besidePage
                    ? {
                        onArrowBesideFile: (direction) => {
                          drivePage(besidePage, {
                            key:
                              direction === "left" ? "ArrowLeft" : "ArrowRight",
                            type: "key",
                          });
                          return true;
                        },
                      }
                    : {})}
                  onNewFolder={
                    folderOnScreenPath === undefined
                      ? undefined
                      : () => {
                          void newFolderIn({
                            hostPath: folderOnScreenPath,
                            prefix: onScreen,
                          });
                        }
                  }
                  onCopy={(picked) => void copyFiles(picked)}
                  onCopyPath={(picked) => void copyPaths(picked)}
                  onCut={(picked) => void cutFiles(picked)}
                  onMoveHere={() => {
                    moveClipboardInto(pasteDestination(document.activeElement));
                  }}
                  onDuplicate={(picked) => void duplicate(picked)}
                  onTrash={(picked) => void trash(picked)}
                  openFolders={isRecents ? undefined : openFolders}
                  onViewChange={(next) => {
                    if (next !== "list") setDefaultView(next);
                    keepLook({
                      group: shown.group,
                      sort: shown.sort,
                      view: next,
                    });
                    // The step on screen takes the new layout rather than a
                    // new step being made for it, the way the Finder's does.
                    go({ type: "setLayout", view: next });
                  }}
                  pendingFolders={pendingFolders}
                  // Resting on a folder reads it ahead, so opening it in place
                  // is the listing already in hand.
                  prefetchChildren={readAhead}
                  ref={fileSystemRef}
                  renderFileStage={(file) => {
                    const tab = fileTabOf(file);
                    // A picture at its own size: the thumbnail the rows and
                    // tiles use is too small for a pane this wide.
                    if (
                      tab &&
                      file.url &&
                      getFileType({
                        filename: tab.name,
                        mimeType: file.contentType,
                      }) === "image"
                    ) {
                      return (
                        <StagePicture fallbackAspect={4 / 3} src={file.url} />
                      );
                    }
                    // An app's icon at the size the grid already holds, which
                    // is more than the pane draws it at, and bare.
                    if (tab && file.previewImageUrl && file.previewIsIcon) {
                      return (
                        <StagePicture
                          bare
                          fallbackAspect={1}
                          src={file.previewImageUrl}
                        />
                      );
                    }
                    // Anything else the system draws is drawn here as the grid
                    // draws it, by the system, larger: the one picture of a
                    // file wherever it is shown.
                    if (tab && file.previewImageUrl) {
                      const larger = new URL(file.previewImageUrl);
                      larger.searchParams.set("thumbnail", "1024");
                      return (
                        <StagePicture
                          fallbackAspect={
                            file.contentType?.startsWith("image/")
                              ? 4 / 3
                              : PAGE_ASPECT
                          }
                          src={larger.href}
                        />
                      );
                    }
                    // Text the system has no picture of (code, mostly) reads as
                    // a thumbnail of the document in its viewer.
                    if (!tab || !isTextLike(file)) {
                      return null;
                    }
                    return (
                      <FileThumbnail
                        hostPath={tab.hostPath}
                        key={tab.hostPath}
                        name={tab.name}
                        url={file.url}
                        version={file.updatedAt}
                      />
                    );
                  }}
                  {...(rowLead
                    ? {}
                    : {
                        renderHeaderLead: () => (
                          <span className="flex items-center pr-1">
                            {placesToggle}
                          </span>
                        ),
                      })}
                  renderHeaderActions={(folded) => (
                    <FolderOverflowMenu
                      {...menuActionsFor(selectedItem)}
                      folded={folded}
                      item={selectedItem}
                      onClosed={afterMenuClosed}
                    />
                  )}
                  onSearchNeedsRoomChange={setSearchNeedsRoom}
                  // Where the folder's contents would be: the whole browser for
                  // the folder on screen, its column's place beside the folder
                  // above it in the columns, a line under it in the list.
                  renderUnreadable={(prefix, place) => {
                    if (prefix === "" && place === "pane" && rootNotFound) {
                      return rootNotFound;
                    }
                    const refusal = refusalOf(prefix);
                    if (!refusal) {
                      return null;
                    }
                    if (place === "inline") {
                      return refusalLine(refusal.reason);
                    }
                    return (
                      <NotPermitted
                        key={refusal.path}
                        onGranted={(granted) => {
                          reread();
                          // A folder above this one, the guarded one that
                          // refused it, opens this one with it.
                          if (!isInside(refusal.path, granted)) {
                            rootTo(granted);
                          }
                        }}
                        refusal={refusal}
                      />
                    );
                  }}
                  selectedPath={selectedPath}
                  showHiddenFiles={showHiddenFiles}
                  group={shown.group}
                  sort={shown.sort}
                  title={rootName}
                  {...(beside === undefined
                    ? {}
                    : {
                        besideClosing: beside.isClosing,
                        besideResizing: beside.isResizing,
                        besideWidth: beside.width,
                        ...(beside.openPath === undefined
                          ? {}
                          : { besideOpenPath: beside.openPath }),
                      })}
                  {...(toolsInRow
                    ? {
                        toolbarInto: {
                          lead: rowTools,
                          ...(isBesideOpen ? {} : { tail: rowTail ?? null }),
                        },
                      }
                    : {})}
                  view={view}
                />
              </div>
            </ContextMenuTrigger>
            {clashQuestions.dialog}
            <FolderMenu
              {...menuActionsFor(menuItem)}
              isRecents={isRecents}
              item={menuItem}
              onClosed={afterMenuClosed}
              onSortKey={(key) => {
                sortBy(
                  key === shown.sort.key
                    ? shown.sort
                    : {
                        direction:
                          SORT_BY.find((option) => option.key === key)
                            ?.direction ?? "asc",
                        key,
                      },
                );
              }}
              // Grouped, the groups are the order, as in the toolbar's menu.
              {...(shown.group === null ? { sort: shown.sort } : {})}
            />
          </ContextMenu>
          {currentListing?.appFoldersLocked && <ICloudAccessBanner />}
        </div>
      )}
    </div>
  );
}

// oxlint-disable studio/no-os-words -- shown only on macOS, the one system with iCloud Drive's app folders
/**
 * Under the top of iCloud Drive while macOS keeps its app folders from
 * Instrument. The first read asks for the iCloud Drive permission, and macOS
 * never asks twice, so after that the switch in System Settings is the only
 * way in.
 */
function ICloudAccessBanner() {
  const openSettings = useMutation(
    rpcClient.features.openPrivacySettings.mutationOptions(),
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground">
      <p className="min-w-0 flex-1 leading-5">
        Some folders in iCloud Drive need your permission before Instrument can
        show them. You can turn on iCloud Drive for Instrument in System
        Settings.
      </p>
      <Button
        onClick={() => {
          openSettings.mutate({ pane: "FilesAndFolders" });
        }}
        size="sm"
        variant="outline"
      >
        Open System Settings
      </Button>
    </div>
  );
}
// oxlint-enable studio/no-os-words

/**
 * Puts back each journal entry, the last first, stopping at the first that
 * cannot come back. One already put back another way is passed over.
 */
async function undoInTurn(
  journalIds: readonly string[],
  onUndone: (undone: RPCOutput["files"]["undo"]) => void,
) {
  for (const journalId of journalIds.toReversed()) {
    const undone = await rpcClient.files.undo
      .call({ journalId })
      .catch((error: unknown) => {
        if (error instanceof ORPCError && error.code === "NOTHING_TO_UNDO") {
          return null;
        }
        throw error;
      });
    if (undone) {
      onUndone(undone);
    }
  }
}

/**
 * Moves each path to the Trash in turn, so a failure stops short of the rest
 * rather than leaving which of them went to chance. Told of each as it goes,
 * with the journal entry that can put it back.
 */
async function trashInTurn(
  paths: readonly string[],
  onTrashed: (journalId: null | string) => void,
) {
  for (const path of paths) {
    const { journalId } = await rpcClient.files.trash.call({ path });
    onTrashed(journalId);
  }
}

/**
 * What a folder's layout and order are kept under: where it is on the
 * computer, a root under `~` spelled out below the home folder, or the
 * recents' own root for the recents.
 */
function folderViewKey(root: string, prefix: string, home: string | undefined) {
  if (root === RECENTS_ROOT) {
    return RECENTS_ROOT;
  }
  const rootHostPath =
    root === "~" && home
      ? home
      : root.startsWith("~/") && home
        ? joinHostPath(home, root.slice(2))
        : root;
  return joinHostPath(rootHostPath, prefix);
}

/**
 * The layout a folder opens in when arrived at directly, read from what the
 * window keeps: the folder's own, or the last one chosen anywhere.
 */
export function arrivalViewOf(root: string, prefix: string) {
  const store = getDefaultStore();
  const key = folderViewKey(root, prefix, window.api.homeDir);
  return arrivalView(
    store.get(computerFolderViewsAtom)[key]?.view,
    store.get(computerViewAtom),
  );
}

/**
 * Where up from the top of a tab's tree goes: the folder the root sits in,
 * with the root selected in it. Nothing is above a disk.
 */
export function rootParentSearch(
  rootHostPath: string | undefined,
  /** Whether the root is the top of a disk, though a folder is above it: `/Volumes/Backup`. */
  { isDisk = false }: { isDisk?: boolean | undefined } = {},
) {
  if (!rootHostPath) {
    return undefined;
  }
  // Up from the top of a disk is the computer, every disk side by side.
  const above = parentFolderOf(rootHostPath);
  if (above === null || isDisk) {
    return { path: "", root: COMPUTER_ROOT };
  }
  return {
    path: "",
    root: above,
    select: `${segmentsOf(rootHostPath).at(-1) ?? ""}/`,
  };
}

/**
 * Whether macOS asks the person before the app reads a folder, the first
 * time it does: in Desktop, Documents, Downloads, iCloud Drive or a disk
 * (`macosGuardedRoot`, which main answers by). A pointer passing over one is
 * no reason to raise that question, so these are read when opened.
 */
function macosAsksFirst(hostPath: string) {
  if (!isMacOS()) {
    return false;
  }
  const home = window.api.homeDir;
  const at = expandHomePath(hostPath, home);
  return (
    // oxlint-disable-next-line studio/no-os-words -- a folder name, never shown
    ["Desktop", "Documents", "Downloads", "Library/Mobile Documents"].some(
      (name) => {
        const root = `${home}/${name}`;
        return at === root || at.startsWith(`${root}/`);
      },
    ) || /^\/Volumes\/[^/]+/.test(at)
  );
}

/**
 * Why Files never trashes, renames, duplicates or moves an item, or
 * undefined when it may: one of the computer's own folders, or one of the
 * folders Instrument runs on in `workspace` (`keptInPlaceReason`, which the
 * files routes also check).
 */
function keptInPlaceOf(
  item: FileSystemItem | string,
  workspace: string | undefined,
): string | undefined {
  const hostPath = typeof item === "string" ? item : hostPathOfItem(item);
  if (hostPath === "") {
    return undefined;
  }
  const home = window.api.homeDir;
  return keptInPlaceReason(expandHomePath(hostPath, home), {
    home,
    os: currentOs(),
    workspace,
  });
}

/**
 * Why Files leaves an item where it is, by the workspace the window runs on
 * (`keptInPlaceOf`).
 */
function useKeptInPlace() {
  const workspace = useWorkspaceFolder();
  return (item: FileSystemItem | string) => keptInPlaceOf(item, workspace);
}

/** Says an action was left undone, and why the folder stays where it is. */
function keptInPlaceToast(title: string, reason: string) {
  toast.error(title, { description: reason });
}

/** What can move into `folder`: nothing already there, and no folder into itself. */
function movableInto<T extends { hostPath: string }>(
  sources: readonly T[],
  folder: string,
) {
  return sources.filter(
    (source) =>
      joinHostPath(folder, nameOf(source.hostPath)) !== source.hostPath &&
      !isInside(folder, source.hostPath),
  );
}

function cutRowsStyle(rows: readonly { path: string }[]) {
  const selectors = rows.map(
    (row) => `[data-file-system-item="${CSS.escape(row.path)}"]`,
  );
  return selectors.length > 0 ? `${selectors.join(",")}{opacity:.5}` : "";
}

/** The folder above a prefix like `docs/notes/`, as a prefix. */
function parentPrefixOf(prefix: string) {
  const at = prefix.replace(/\/$/u, "").lastIndexOf("/");
  return at === -1 ? "" : prefix.slice(0, at + 1);
}

function isSamePathSet(left: readonly string[], right: readonly string[]) {
  const those = new Set(right);
  return (
    left.length > 0 &&
    left.length === those.size &&
    left.every((path) => those.has(path))
  );
}

/**
 * A file or folder a tab shows that is not where the tab says, drawn where it
 * would be. The tab keeps its place and its name, as a browser tab keeps a
 * page that failed to load, so a move or a delete outside the app never
 * closes or walks a tab on its own.
 */
export function NotFound({
  hostPath,
  kind,
  onShowFolder,
  onTryAgain,
}: {
  hostPath: string;
  kind: "file" | "folder";
  /** Opens the nearest folder above it that is still there. */
  onShowFolder: () => void;
  onTryAgain: () => void;
}) {
  const name = segmentsOf(hostPath).at(-1) ?? hostPath;
  const Glyph = kind === "file" ? FileDashedIcon : FolderDashedIcon;
  return (
    <div className="flex size-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <Glyph className="size-10 text-muted-foreground opacity-60" />
        <div>
          <p className="text-sm font-medium break-all">{`Can’t find “${name}”`}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            It may have been moved, deleted, or saved on another computer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onShowFolder} size="sm">
            Show Folder
          </Button>
          <Button onClick={onTryAgain} size="sm" variant="outline">
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The nearest folder that is still there, from `hostPath` itself up to the
 * top of the computer.
 */
export async function nearestFolderThere(hostPath: string): Promise<string> {
  const chain: string[] = [];
  for (let at: null | string = hostPath; at !== null; at = parentFolderOf(at)) {
    chain.push(at);
  }
  const { missing } = await rpcClient.files.missing.call({ paths: chain });
  return chain.find((at) => !missing.includes(at)) ?? COMPUTER_ROOT;
}

/** How often a tab whose folder is gone looks for it again while it is up. */
const ROOT_RECHECK_MS = 3000;

/** A folder prefix and every folder above it, root first: `a/b/` is `""`, `a/`, `a/b/`. */
function prefixesOf(folder: string): string[] {
  const prefixes = [""];
  let at = "";
  for (const part of folder.split("/").filter(Boolean)) {
    at = `${at}${part}/`;
    prefixes.push(at);
  }
  return prefixes;
}

/**
 * The path a thing beside this one would have: the same folder, a name of its
 * own, and a folder stays a folder. What a rename or a duplicate leaves the
 * selection on, said in the paths the browser knows things by.
 */
function siblingPath(path: string, name: string) {
  const isFolder = path.endsWith("/");
  const trimmed = isFolder ? path.slice(0, -1) : path;
  const at = trimmed.lastIndexOf("/");
  return `${at === -1 ? "" : trimmed.slice(0, at + 1)}${name}${isFolder ? "/" : ""}`;
}

/**
 * The picture in the columns' preview. Until it has arrived it holds the
 * shape it is expected in, so the name and details under it stand where
 * they will stay rather than jumping down once it loads.
 */
function StagePicture({
  bare = false,
  fallbackAspect,
  src,
}: {
  /** No frame around it, for an icon that carries its own shape. */
  bare?: boolean;
  /** Width over height while the picture is on its way. */
  fallbackAspect: number;
  src: string;
}) {
  const [loaded, setLoaded] = useState<string>();
  const [broken, setBroken] = useState<string>();
  const isLoaded = loaded === src;
  if (broken === src) {
    return null;
  }
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        !bare && "rounded-xl shadow-sm ring-1 ring-border",
        !isLoaded && !bare && "bg-muted",
      )}
      style={isLoaded ? undefined : { aspectRatio: fallbackAspect }}
    >
      <img
        alt=""
        // Held out of the flow until it has loaded, inside the box, so an
        // image of unknown width never widens the pane it waits in.
        className={cn("w-full", !isLoaded && "invisible absolute inset-0")}
        draggable={false}
        onError={() => {
          setBroken(src);
        }}
        onLoad={() => {
          setLoaded(src);
        }}
        src={src}
      />
    </div>
  );
}

const TEXT_EXTENSIONS = new Set([
  "css",
  "csv",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "py",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

/** The selected row the keyboard is on, of several. */
function selectedRowIn(browser: HTMLElement | null) {
  return (
    browser?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"][tabindex="0"]',
    ) ??
    browser?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    ) ??
    browser?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ??
    null
  );
}

/** What the info card says about a row, read from what the row already has. */
function infoItemOf(item: FileSystemItem): FileInfoItem[] {
  const hostPath = hostPathOfItem(item);
  if (!hostPath) {
    return [];
  }
  const dates = {
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { modifiedAt: item.updatedAt } : {}),
  };
  if (item.kind === "folder") {
    return [
      {
        ...dates,
        ...(item.glyphSrc ? { glyphSrc: item.glyphSrc } : {}),
        hostPath,
        kind: "folder",
        kindLabel: "Folder",
        name: item.name ?? folderNameFromPath(hostPath),
      },
    ];
  }
  const name = folderNameFromPath(hostPath);
  return [
    {
      ...dates,
      ...(item.contentType ? { contentType: item.contentType } : {}),
      hostPath,
      kind: "file",
      kindLabel: itemKindLabel({
        name,
        ...(item.contentType ? { contentType: item.contentType } : {}),
        ...(item.typeName ? { typeName: item.typeName } : {}),
      }),
      ...(item.size === undefined ? { isPackage: true } : {}),
      name: item.displayName ?? name,
      ...(item.previewImageUrl && !item.previewIsIcon
        ? { previewImageUrl: item.previewImageUrl }
        : {}),
      ...(item.size === undefined ? {} : { size: item.size }),
    },
  ];
}

/** What Quick Look shows for an item: a file as its tab, a folder as its card. */
function lookTargetOf(item: FileSystemItem): LookTarget | undefined {
  if (item.kind === "file") {
    const tab = fileTabOf(item);
    return tab && { kind: "file", tab };
  }
  const hostPath = hostPathOfItem(item);
  if (!hostPath) {
    return;
  }
  return {
    folder: {
      ...(item.glyphSrc ? { glyphSrc: item.glyphSrc } : {}),
      hostPath,
      ...(item.updatedAt ? { modifiedAt: item.updatedAt } : {}),
      name: item.name ?? folderNameFromPath(hostPath),
    },
    kind: "folder",
  };
}

/** A file that reads as text: by its declared type, or by an extension a person would open in an editor. */
function isTextLike(file: FileSystemFileItem) {
  if (file.contentType?.startsWith("text/")) {
    return true;
  }
  const extension = file.path.split(".").at(-1)?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}
