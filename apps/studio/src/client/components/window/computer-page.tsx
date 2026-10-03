import {
  type ChosenItem,
  computerColumnWidthAtom,
  type ComputerFolderView,
  computerFolderViewsAtom,
  computerHiddenFilesAtom,
  computerListColumnsAtom,
  computerListColumnWidthsAtom,
  computerSortAtom,
  computerViewAtom,
  type FileTab,
  finderPlacesOpenAtom,
  finderPlacesWidthAtom,
} from "@/client/atoms/window";
import {
  FileSystem,
  type FileSystemFileItem,
  FileSystemFolderGlyph,
  type FileSystemItem,
  type FileSystemSortKey,
  type FileSystemSortState,
  TOOLBAR_CONTROL_CLASSNAME,
  TOOLBAR_ICON_BUTTON_CLASSNAME,
} from "@/client/components/extend/file-system";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { INSTRUMENT_FOLDER_GLYPH_URL } from "@/client/components/icons/instrument-folder";
import { NewTabIcon } from "@/client/components/icons/new-tab-icon";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { OpenTargetIcon } from "@/client/components/open-target-icon";
import { OpenInMenu } from "@/client/components/open-with-menu";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { useTheme } from "@/client/components/theme-provider";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { Spinner } from "@/client/components/ui/spinner";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { useFileOpenTarget } from "@/client/hooks/use-file-open-target";
import { useOpenFile } from "@/client/hooks/use-open-file";
import {
  getComputerFileUrl,
  getComputerThumbnailUrl,
} from "@/client/lib/computer-file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn, getRevealInFolderLabel, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { folderNameFromPath } from "@instrument-org/shared";
import {
  type ComputerListing,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { ORPCError } from "@orpc/client";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { FolderPlusIcon } from "@phosphor-icons/react/FolderPlus";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { SortAscendingIcon } from "@phosphor-icons/react/SortAscending";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import ms from "ms";
import { unique } from "radashi";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useWindow } from "./context";
import { FileThumbnail } from "./file-thumbnail";
import { FolderMark } from "./folder-mark";
import { GlyphButton } from "./glyph-button";
import { folderOf, homeRelative, joinHostPath, segmentsOf } from "./host-path";

/**
 * How many folders' layouts are kept. Past it the one left alone longest goes
 * back to opening the way a folder never set does.
 */
const FOLDER_VIEWS_KEPT = 500;

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

/** A page's width over its height, the shape a document's picture is drawn in. */
const PAGE_ASPECT = 0.78;

/** How often every folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("4 seconds");

/**
 * The soonest the recents are read again. Their own clock, slower than a
 * folder's: the answer is read out of what every channel has said, and it can
 * only change when the conversation says something new.
 */
const RECENTS_REFRESH_MS = ms("15 seconds");

/**
 * The place that is not a folder: the files the conversation has shown the
 * user, wherever they live. Stands where a root folder stands, so the browser
 * opens on it the way it opens on Home.
 */
export const RECENTS_ROOT = "recents:";

/**
 * The order the recents open in: the order they were handed over, most
 * recently shown first, which is the order the user met them in.
 */
const RECENTS_SORT: FileSystemSortState = { direction: "desc", key: "shownAt" };

/**
 * The orders the folder's menu offers, in the Finder's words, each opening in
 * the direction the toolbar's sort opens it in. The recents add the order
 * they were shown in, which is theirs alone.
 */
const SORT_BY: {
  direction: "asc" | "desc";
  key: FileSystemSortKey;
  label: string;
  recentsOnly?: boolean;
}[] = [
  { direction: "desc", key: "shownAt", label: "Date Shown", recentsOnly: true },
  { direction: "asc", key: "name", label: "Name" },
  { direction: "asc", key: "kind", label: "Kind" },
  { direction: "desc", key: "updatedAt", label: "Date Modified" },
  { direction: "desc", key: "createdAt", label: "Date Created" },
  { direction: "desc", key: "size", label: "Size" },
];

/** The folder the user is looking at, for the conversation. */
export interface FolderOnScreen {
  /** Whether the agent may write there, when it can reach it at all. */
  access?: "read-only" | "read-write";
  /** As the person writes it: `~/Documents`. */
  display: string;
  hostPath: string;
  /** How the agent reaches it, when a granted folder covers it. */
  mount?: string;
  /** Names selected in it, a folder's with a trailing slash. */
  selected: string[];
  /** What is selected in it, by host path and kind. */
  selectedItems: ChosenItem[];
}

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
 * first time it is opened. Every folder it has asked for is re-read on a
 * clock, so what a task writes shows up without a refresh.
 *
 * A tab of its own is where this belongs, and a box on a page is where it also
 * fits: the page that puts it in a box holds the folder it is looking at
 * itself, so walking the folders leaves the tab where it is.
 */
export function ComputerPage({
  onFolderChange,
  onLocationChange,
  onOpenFile,
  onQuickLook,
  onQuickLookFollow,
  path,
  quickLookOpen = false,
  refreshInterval = REFRESH_MS,
  root,
  select,
}: {
  /** Told the folder on screen whenever it changes; null when nothing on screen is a folder. */
  onFolderChange?: (folder: FolderOnScreen | null) => void;
  /**
   * Where the browser has moved to. Left out, it writes the tab's own address,
   * which is what the screen filling a tab wants; given, the page holding the
   * browser keeps the folder in its own state and the tab stays where it is.
   */
  onLocationChange?: (location: { path: string; root: string }) => void;
  /** A file the user opened, when a granted folder covers it. */
  onOpenFile: (file: FileTab) => void;
  /** The selected file, on Space. Left out, Space is not watched for at all. */
  onQuickLook?: (file: FileTab) => void;
  /** The file the selection moved to while Quick Look is up, for it to show. */
  onQuickLookFollow?: (file: FileTab) => void;
  path: string;
  /** Whether Quick Look is up: the arrows then move the selection under it. */
  quickLookOpen?: boolean;
  /** How often every folder on screen is re-read; false to read each once. */
  refreshInterval?: false | number;
  root: string;
  /** What the folder opens with selected, as a path under the root: a file shown in its folder. */
  select?: string;
}) {
  const { askAbout, openScreen, rowLead } = useWindow();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Held above the browser, which is rebuilt on every opening, so the column
  // width and the dotfiles answer survive walking into the next folder. The
  // layout and order are kept per folder, below; these two are what a folder
  // of no layout of its own opens in when nothing is on screen to keep.
  const [defaultView, setDefaultView] = useAtom(computerViewAtom);
  const [defaultSort, setDefaultSort] = useAtom(computerSortAtom);
  const [folderViews, setFolderViews] = useAtom(computerFolderViewsAtom);
  const [columnWidth, setColumnWidth] = useAtom(computerColumnWidthAtom);
  const [listColumns, setListColumns] = useAtom(computerListColumnsAtom);
  const [listColumnWidths, setListColumnWidths] = useAtom(
    computerListColumnWidthsAtom,
  );
  const [showHiddenFiles, setShowHiddenFiles] = useAtom(
    computerHiddenFilesAtom,
  );
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  // The recents stand where a root folder stands, and are listed the way a
  // folder is, so everything the browser does to a folder it does to them.
  const isRecents = root === RECENTS_ROOT;
  const recents = useQuery(
    rpcClient.workspace.computer.recents.queryOptions({
      enabled: isRecents,
      refetchInterval:
        refreshInterval === false
          ? false
          : Math.max(refreshInterval, RECENTS_REFRESH_MS),
    }),
  );
  const homePath = window.api.homeDir;
  const instrumentPath = places.data?.favorites.find(
    (place) => place.name === "Instrument",
  )?.path;
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
  const prefixes = loaded.root === root ? loaded.prefixes : prefixesOf(path);
  // The folder the browser has open, as it last said; the address follows it.
  const [current, setCurrent] = useState(path);
  // The path rather than the item: the items are rebuilt on every re-read,
  // and a selection held as one of them would change with each.
  const [selectedPath, setSelectedPath] = useState<null | string>(
    select ?? null,
  );
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
  // The address this page wrote last, so one that arrives from outside can
  // be told from the page's own echo of what the browser showed. A ref, not
  // state: the router answers a write in a render of its own, ahead of any
  // state set beside the write, and a page that read stale state there took
  // every selection for an arrival and reopened the browser at it.
  const written = useRef(`${root}#${path}`);
  // How many times the browser has been opened at an address from outside.
  // It takes only a starting folder, so a Recent entry, the omnibox, or
  // history landing here while the screen is up opens it again there.
  const [openings, setOpenings] = useState(0);
  // Whether the address on screen was handed to the page rather than written
  // by it, until the browser has caught up with it: the folder the browser
  // first settles on there stands for that address, and replaces it rather
  // than stepping past it.
  const arrived = useRef(true);
  useEffect(() => {
    const here = `${root}#${path}`;
    const [writtenRoot] = written.current.split("#");
    if (written.current === here) {
      return;
    }
    const rootChanged = root !== writtenRoot;
    written.current = here;
    arrived.current = true;
    setCurrent(path);
    setSelectedPath(select ?? null);
    setLoaded((previous) => ({
      prefixes: rootChanged
        ? prefixesOf(path)
        : unique([...previous.prefixes, ...prefixesOf(path)]),
      root,
    }));
    setOpenings((count) => count + 1);
  }, [path, root, select]);

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
  // The item whose name is being typed over, by the path the browser knows it
  // by; the row itself holds the field.
  const [renamingPath, setRenamingPath] = useState<null | string>(null);

  const listings = useQueries({
    combine: combineListings,
    queries: isRecents
      ? []
      : prefixes.map((prefix) =>
          rpcClient.workspace.computer.list.queryOptions({
            input: { id: WINDOW_ID, path: hostPathOf(prefix) },
            refetchInterval: refreshInterval,
            retry: false,
          }),
        ),
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
  // A folder that has gone (thrown away here, moved in the Finder) is asked
  // for on the clock until it is let go of, which is a failing read every few
  // seconds for as long as the screen is up. Opening it again brings it back.
  // A folder the system refused is kept: it is on the same clock, and the
  // clock is what fills the column the moment the refusal is undone.
  const goneFolder = prefixes.find((prefix, index) => {
    const listing = listings[index];
    return (
      prefix !== "" &&
      listing?.isError === true &&
      !isNotPermitted(listing.error)
    );
  });
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
  // The recents as a folder's worth of files: named where they live, and flat,
  // since a list of what was shown is not a tree.
  const recentEntries = recents.data ?? [];
  const recentKeys = recentPaths(recentEntries);
  const recentItems = recentEntries.map((entry, index): FileSystemItem => {
    return {
      contentType: entry.mimeType,
      ...(entry.createdAt === undefined
        ? {}
        : { createdAt: new Date(entry.createdAt).toISOString() }),
      kind: "file",
      metadata: { hostPath: entry.path },
      name: entry.name,
      path: recentKeys[index] ?? entry.name,
      ...previewOf(entry, resolvedTheme),
      shownAt: new Date(entry.shownAt).toISOString(),
      size: entry.size,
      ...(entry.modifiedAt === undefined
        ? {}
        : { updatedAt: new Date(entry.modifiedAt).toISOString() }),
    };
  });
  const folderItems = listings.flatMap(({ data }, index) => {
    const prefix = prefixes[index] ?? "";
    if (!data) {
      return [];
    }
    return (
      data.entries
        // The browser hides a name that begins with a dot itself. Windows keeps
        // the answer as a file attribute instead, which only the listing can
        // read, so those are dropped here -- under the same switch, so one menu
        // item still governs everything the system would rather you did not see.
        .filter((entry) => showHiddenFiles || !entry.hidden)
        .map((entry): FileSystemItem => {
          const stamps = {
            ...(entry.createdAt === undefined
              ? {}
              : { createdAt: new Date(entry.createdAt).toISOString() }),
            ...(entry.modifiedAt === undefined
              ? {}
              : { updatedAt: new Date(entry.modifiedAt).toISOString() }),
          };
          if (entry.kind === "folder") {
            return {
              ...stamps,
              ...(entry.path === instrumentPath
                ? { glyphSrc: INSTRUMENT_FOLDER_GLYPH_URL }
                : {}),
              hasChildren: true,
              kind: "folder",
              metadata: { hostPath: entry.path },
              path: `${prefix}${entry.name}/`,
            };
          }
          // Read by where it is, as the listing was: whatever the column can
          // list, the viewer can show, whether or not the agent can reach it.
          return {
            ...stamps,
            contentType: entry.mimeType,
            kind: "file",
            metadata: { hostPath: entry.path },
            path: `${prefix}${entry.name}`,
            ...previewOf(entry, resolvedTheme),
            size: entry.size,
          };
        })
    );
  });
  const items = isRecents ? recentItems : folderItems;
  const itemsByPath = new Map(items.map((item) => [item.path, item]));
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

  // The listings are on a clock, but a folder the user just changed should
  // not wait for it.
  const reread = () => {
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.computer.list.key(),
    });
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.computer.recents.key(),
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
    try {
      const made = await rpcClient.files.newFolder.call({
        parent: parent.hostPath,
      });
      reread();
      // Made and named in one move, the way the Finder does it: the field
      // opens on the row as soon as the re-read puts the folder there.
      setRenamingPath(`${parent.prefix}${made.path.split("/").at(-1) ?? ""}/`);
    } catch (error) {
      failed(error);
    }
  };
  const rename = async (item: FileSystemItem, name: string) => {
    const hostPath = hostPathOfItem(item);
    if (!hostPath) {
      return;
    }
    try {
      await rpcClient.files.rename.call({ name, path: hostPath });
      // The thing renamed is the thing still selected, so the column it sits
      // in stays open rather than closing under a selection that has gone.
      setSelectedPath(siblingPath(item.path, name));
      reread();
    } catch (error) {
      failed(error);
    }
  };
  const duplicate = async (picked: FileSystemItem[]) => {
    try {
      for (const item of picked) {
        const hostPath = hostPathOfItem(item);
        if (!hostPath) {
          continue;
        }
        const copy = await rpcClient.files.duplicate.call({ path: hostPath });
        // The copy is what the Finder leaves selected, and where the keyboard
        // carries on from. Several copied leave the several selected.
        if (picked.length === 1) {
          setSelectedPath(
            siblingPath(item.path, copy.path.split("/").at(-1) ?? ""),
          );
        }
      }
      focusBrowser();
    } catch (error) {
      failed(error);
    } finally {
      reread();
    }
  };
  // Where the thing sits on the Mac, as a terminal, a Finder window or another
  // app takes it. The browser's own path names a place inside the browser and
  // is no use anywhere else.
  const copyPath = async (item: FileSystemItem | undefined) => {
    const hostPath = hostPathOfItem(item);
    if (!hostPath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(hostPath);
      focusBrowser();
    } catch (error) {
      failed(error);
    }
  };
  const trash = async (picked: FileSystemItem[]) => {
    const hostPaths = picked.map(hostPathOfItem).filter(Boolean);
    if (hostPaths.length === 0) {
      return;
    }
    try {
      // One at a time, so a failure stops short of the rest rather than
      // leaving which of them went to chance.
      for (const hostPath of hostPaths) {
        await rpcClient.files.trash.call({ path: hostPath });
      }
      setSelectedPath(null);
      focusBrowser();
    } catch (error) {
      failed(error);
    } finally {
      reread();
    }
  };

  const listingOf = (prefix: string) =>
    listings[prefixes.indexOf(prefix)]?.data;
  // Whether the folder the page is holding belongs to the root it was handed.
  // A new root arrives a render ahead of the reset that clears the folder
  // under it, and writing the address in between paired the root being opened
  // with the folder being left: an address to a folder that is not there,
  // written to history for the back button to return to.
  const settled = loaded.root === root;
  // The recents are rooted nowhere, so no place in the list is the one open.
  // A root under `~` (the Instrument folder a fresh Finder opens at) is the
  // same folder spelled out below the home folder.
  const rootHostPath = isRecents
    ? undefined
    : root === "~"
      ? homePath
      : root.startsWith("~/")
        ? homePath && joinHostPath(homePath, root.slice(2))
        : root;

  // Each folder in the layout and order it was last left in, the way a Finder
  // window shows one: walking into a folder with a look of its own takes that
  // look, and walking into one without keeps whatever is on screen. Walking
  // means the browser's own folder changing, by a double-click, the sidebar or
  // back and forward; the columns opening a folder beside the last is still
  // the same window, and nothing changes under the pointer there.
  const folderKeyOf = (prefix: string) =>
    isRecents ? RECENTS_ROOT : hostPathOf(prefix, rootHostPath ?? root);
  const currentKey = folderKeyOf(current);
  const [shown, setShown] = useState(() => {
    const own = folderViews[currentKey];
    return {
      at: currentKey,
      sort: own?.sort ?? (isRecents ? RECENTS_SORT : defaultSort),
      view: own?.view ?? defaultView,
    };
  });
  // Set during render rather than in an effect, so the folder is drawn in its
  // own look from its first frame. A new root arrives a render ahead of the
  // folder under it, so nothing is taken until the two agree. The recents are
  // a list of their own rather than a folder, and open in their own order.
  if (settled && shown.at !== currentKey) {
    const own = folderViews[currentKey];
    setShown({
      at: currentKey,
      sort: own?.sort ?? (isRecents ? RECENTS_SORT : shown.sort),
      view: own?.view ?? shown.view,
    });
  }

  // The folder on screen. In the columns a selected folder shows its contents
  // in the next column, so it is the one the user is looking at, and a
  // selected file is in the folder that lists it. Every other layout shows
  // the browser's own folder whatever is selected in it: selecting a folder
  // there, or a file in a folder opened in place in the list, is not going
  // anywhere, and neither the address nor back and forward move for it.
  // Several selected open nothing past the column that lists them.
  const onScreen =
    selectedPath === null || shown.view !== "columns"
      ? current
      : selectedPath.endsWith("/") && allSelectedPaths.length === 1
        ? selectedPath
        : selectedPath.slice(
            0,
            selectedPath.lastIndexOf("/", selectedPath.length - 2) + 1,
          );
  const currentListing = listingOf(onScreen);
  // The folder standing on screen, by its path: the listing's own once it has
  // arrived, the root the sidebar resolved until then. The recents are a list
  // rather than a folder, and have none.
  const folderOnScreenPath = isRecents
    ? undefined
    : (currentListing?.path ?? hostPathOf(onScreen, rootHostPath ?? root));
  /** A draft with the rows picked to go with it, or with the folder on screen when there are none. */
  const draftAbout = (picked: (FileSystemItem | undefined)[]) => {
    const chosen = picked.flatMap((item) => {
      const itemPath = hostPathOfItem(item);
      return item && itemPath ? [{ kind: item.kind, path: itemPath }] : [];
    });
    if (chosen.length > 0) {
      askAbout?.(chosen);
    } else if (folderOnScreenPath !== undefined) {
      askAbout?.([{ kind: "folder", path: folderOnScreenPath }]);
    }
  };

  // The folder on screen is one the operating system would not let this app
  // read. On a Mac the first read of a protected folder is the system's own
  // ask, so this is what a declined ask looks like, and where it is undone.
  const isCurrentNotPermitted = isNotPermitted(
    listings[prefixes.indexOf(onScreen)]?.error,
  );
  // A change is kept for the folder the window is showing. In the columns that
  // is the last column's folder, which is where leaving the columns goes.
  const keepLook = (look: ComputerFolderView) => {
    setShown((previous) => ({ ...previous, ...look }));
    const key = folderKeyOf(shown.view === "columns" ? onScreen : current);
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
    // The recents' order is their own and says nothing about a folder's.
    if (!isRecents) {
      setDefaultSort(sort);
    }
    keepLook({ sort, view: shown.view });
  };
  // The folder on screen as the address last had it. An address arriving
  // from outside (back, forward, the sidebar) changes `path` a render before
  // the browser is reopened there, and in that render `onScreen` is still the
  // folder being left: written to the address then, it put back the folder
  // back had just left, so one press of back never moved the Finder. Only the
  // folder on screen moving is a step of the page's own.
  const lastOnScreen = useRef(path);
  useEffect(() => {
    if (!settled) {
      return;
    }
    if (onScreen === path) {
      lastOnScreen.current = onScreen;
      arrived.current = false;
      return;
    }
    if (lastOnScreen.current === onScreen) {
      return;
    }
    // Written once the folder has settled: going into a folder in the columns
    // clears the selection a render before the browser stands in the folder,
    // and the folder above, on screen for that one render, is no step.
    const timer = setTimeout(() => {
      lastOnScreen.current = onScreen;
      written.current = `${root}#${onScreen}`;
      const replace = arrived.current;
      arrived.current = false;
      if (onLocationChange) {
        onLocationChange({ path: onScreen, root });
        return;
      }
      // Each folder walked to is a step of the tab's history, so back and
      // forward (the bar's arrows, the thumb buttons, the chords) walk the
      // folders the way the Finder's own do.
      void navigate({
        replace,
        search: (previous) => ({
          ...previous,
          path: onScreen,
          root,
          select: undefined,
        }),
        to: "/files",
      });
    });
    return () => {
      clearTimeout(timer);
    };
  }, [navigate, onLocationChange, onScreen, path, root, settled]);

  // The arrows work the moment a folder is on screen: the first row takes
  // the keyboard on each opening, unless the user is typing somewhere.
  const hasRows = items.length > 0;
  // Only the Finder in the window's tab that is up: every tab stays mounted,
  // and one behind another is not where the keyboard is.
  const isActiveTab = useIsActiveTab();
  useEffect(() => {
    if (!hasRows || !isActiveTab || isTypingTarget(document.activeElement)) {
      return;
    }
    const row = browserRef.current?.querySelector<HTMLElement>(
      '[role="option"][tabindex="0"]',
    );
    row?.focus({ preventScroll: true });
    // Once per opening, when its rows are first there, or when its tab comes
    // up.
  }, [openings, hasRows, isActiveTab]);

  // A name field closing leaves the keyboard on nothing, since the row it was
  // in is being rebuilt under a new name. The browser itself takes it instead,
  // which is where an arrow goes on to find the folder again.
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (renamingPath !== null) {
      wasRenaming.current = true;
      return;
    }
    if (!wasRenaming.current) {
      return;
    }
    wasRenaming.current = false;
    focusBrowser();
  }, [renamingPath]);

  // Anywhere else pressed is the end of the naming, the way it is in the
  // Finder: the field is unmounted, which blurs it, and a blurred field keeps
  // whatever was typed in it.
  useEffect(() => {
    if (renamingPath === null) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input[aria-label="Name"]')
      ) {
        return;
      }
      setRenamingPath(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [renamingPath]);

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
  const hostPath = isRecents
    ? recentFolder
    : (currentListing?.path ?? refusedHostPath);
  const mount = isRecents
    ? selectedRecent?.access && folderOf(selectedRecent.access.mountPath)
    : currentListing?.access?.mountPath;
  const access = isRecents
    ? selectedRecent?.access?.access
    : currentListing?.access?.access;
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
  useEffect(() => {
    // The recents with nothing selected, or a folder not yet read: no folder
    // is on screen, and the one that was is not still the answer.
    if (display === undefined || hostPath === undefined) {
      onFolderChange?.(null);
      return;
    }
    onFolderChange?.({
      ...(access === undefined ? {} : { access }),
      display,
      hostPath,
      ...(mount === undefined ? {} : { mount }),
      selected: selectedOnScreen.map(({ name }) => name),
      selectedItems: selectedOnScreen.map(({ item }) => item),
    });
    // The selection by its key: the rows are rebuilt on every re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, display, hostPath, mount, onFolderChange, selectedKey]);

  const openFile = (file: FileSystemFileItem) => {
    const tab = fileTabOf(file);
    if (tab) {
      onOpenFile(tab);
    }
  };

  // Space on a selected file, the way the Finder shows one over everything.
  const selectedFile = selectedItem?.kind === "file" ? selectedItem : undefined;
  const quickLookTab = selectedFile ? fileTabOf(selectedFile) : undefined;
  const quickLookKey = quickLookTab?.hostPath;
  useEffect(() => {
    // No panel to show one in, no key taken from the rest of the page, and
    // none from a tab that is not up.
    if (!quickLookTab || !onQuickLook || !isActiveTab) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      onQuickLook(quickLookTab);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // The tab is rebuilt with the items on every re-read; its path is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickLookKey, onQuickLook, isActiveTab]);

  // Quick Look stays up while the arrows walk the folder, and shows whatever
  // the selection lands on. The panel holds the keyboard, so the keys are
  // handed to the browser's selected row, which answers them as its own;
  // only the user's own presses are forwarded, not the copies.
  useEffect(() => {
    if (!quickLookOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || !event.key.startsWith("Arrow")) {
        return;
      }
      // The selected row the keyboard is on, of several.
      const row =
        browserRef.current?.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"][tabindex="0"]',
        ) ??
        browserRef.current?.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"]',
        ) ??
        browserRef.current?.querySelector<HTMLElement>(
          '[role="option"][tabindex="0"]',
        );
      if (!row) {
        return;
      }
      event.preventDefault();
      row.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: event.key,
        }),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [quickLookOpen]);
  useEffect(() => {
    if (quickLookOpen && quickLookTab) {
      onQuickLookFollow?.(quickLookTab);
    }
    // The tab is rebuilt with the items on every re-read; its path is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickLookKey, quickLookOpen, onQuickLookFollow]);

  // In a narrow tab the places stand over the folder rather than beside it,
  // put away until asked for and again once one is chosen. A wide one keeps
  // them beside it unless they were put away, which every Finder remembers.
  const [isPlacesOpen, setPlacesOpen] = useState(false);
  const [isPlacesShown, setPlacesShown] = useAtom(finderPlacesOpenAtom);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const isNarrow = useIsNarrow(frame);
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
    if (onLocationChange) {
      onLocationChange({ path: prefix, root: folder });
      return;
    }
    void navigate({
      search: { path: prefix, root: folder },
      to: "/files",
    });
  };

  if (!places.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  /** A place in a tab of its own, waiting behind; the recents by their own address. */
  const openPlaceInNewTab = (place: string) => {
    openScreen(folderHref(place), { behind: true, newTab: true });
  };
  const placeMenu = (place: string) => (
    <PlaceMenu
      hostPath={place}
      onNewDraft={
        askAbout &&
        (() => {
          askAbout([{ kind: "folder", path: place }]);
        })
      }
      onOpenInNewTab={() => {
        openPlaceInNewTab(place);
      }}
    />
  );
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
      onDuplicate: () => void duplicate(picked),
      onNewDraft:
        askAbout && (item || folderOnScreenPath !== undefined)
          ? () => {
              draftAbout(picked);
            }
          : undefined,
      onTrash: () => void trash(picked),
      ...(group
        ? {
            onOpen: () => {
              openInTabs(group, { behind: false });
            },
            onOpenInNewTab: () => {
              openInTabs(group, { behind: true });
            },
            onQuickLook: undefined,
            onRename: undefined,
            group,
          }
        : {}),
    };
  };
  // Several opened at once cannot all stand in this tab, so each comes up in
  // a tab of its own: the first in front when they were opened, every one
  // behind this when they were opened in new tabs. A file comes up with the
  // folder it was chosen in as its tree, the way one opened in place does.
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
  const menuActionsForOne = (item: FileSystemItem | undefined) => ({
    onCopyPath: () => void copyPath(item),
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
      openInTabs(item ? [item] : [], { behind: true });
    },
    onQuickLook:
      onQuickLook &&
      (() => {
        const tab = item?.kind === "file" ? fileTabOf(item) : undefined;
        if (tab) {
          onQuickLook(tab);
        }
      }),
    onRename: () => {
      const renaming = item?.path ?? null;
      afterMenu.current = () => {
        setRenamingPath(renaming);
      };
    },
    onReveal: () =>
      void rpcClient.utils.showFileInFolder
        .call({ filepath: hostPathOfItem(item) })
        .catch(failed),
  });
  const rootName = isRecents
    ? "Recents"
    : root === "~"
      ? folderNameFromPath(homePath)
      : (places.data.volumes.find((volume) => volume.path === root)?.name ??
        segmentsOf(root).at(-1) ??
        "Root");
  // The folder on screen, which is the only row the sidebar marks: a place
  // walked down out of is no longer where the user is, so nothing is marked
  // until a folder is one of the places itself.
  const folderHostPath = isRecents
    ? undefined
    : (currentListing?.path ?? hostPathOf(onScreen, rootHostPath ?? root));
  const onPlacesKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    enterListing();
  };
  const placeLists = (
    <>
      {/* What the conversation showed, before the places a person keeps things. */}
      <PlaceList
        onOpenInNewTab={openPlaceInNewTab}
        onOpen={(folder) => {
          rootTo(folder);
        }}
        places={[
          {
            icon: (
              <ClockCounterClockwiseIcon className="size-4 text-muted-foreground" />
            ),
            isActive: isRecents,
            name: "Recents",
            path: RECENTS_ROOT,
          },
        ]}
      />
      <PlaceList
        label="Favorites"
        menu={placeMenu}
        onOpenInNewTab={openPlaceInNewTab}
        onOpen={(folder) => {
          rootTo(folder === homePath ? "~" : folder);
        }}
        places={places.data.favorites.map((place) => ({
          // The home folder wears the house it wears in the Finder, which
          // is what says the account-named folder is home.
          icon: <FolderMark large path={place.path} />,
          isActive: folderHostPath === place.path,
          name: place.name,
          path: place.path,
        }))}
      />
      <PlaceList
        label="Locations"
        menu={placeMenu}
        onOpenInNewTab={openPlaceInNewTab}
        onOpen={(folder) => {
          rootTo(folder);
        }}
        places={places.data.volumes.map((volume) => ({
          icon: <FolderMark large path={volume.path} />,
          isActive: folderHostPath === volume.path,
          name: volume.name,
          path: volume.path,
        }))}
      />
    </>
  );
  return (
    // A container, so the places give the folder their room when the tab is
    // narrow: below it they stand over the folder, behind a toggle at the
    // head of the tab's row.
    <div
      className="@container/finder relative flex h-full min-h-0"
      ref={setFrame}
    >
      {/* At the row's far left where the tab has one, the way a file's tree
          toggle is; at the head of the toolbar where it does not. */}
      {rowLead && createPortal(placesToggle, rowLead)}
      {isNarrow && isPlacesOpen && (
        <button
          aria-label="Hide the sidebar"
          className="absolute inset-0 z-20 cursor-default"
          onClick={() => {
            setPlacesOpen(false);
          }}
          tabIndex={-1}
          type="button"
        />
      )}
      {isNarrow ? (
        <nav
          className={cn(
            "absolute inset-y-0 left-0 z-30 flex w-44 flex-col gap-4 overflow-y-auto border-r border-border bg-background px-2 py-2 text-sm shadow-xl-soft select-none",
            !isPlacesOpen && "hidden",
          )}
          onKeyDown={onPlacesKeyDown}
        >
          {placeLists}
        </nav>
      ) : (
        // Beside the folder the way the window's own rail is: its edge
        // drags, an over-drag puts it away, and it slides at its width.
        <StudioSidebarRail
          bounds={PLACES_BOUNDS}
          isOpen={isPlacesShown}
          label="Resize the sidebar"
          onCollapse={() => {
            setPlacesShown(false);
          }}
          panelClassName="bg-background"
          widthAtom={finderPlacesWidthAtom}
        >
          <nav
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-2 text-sm"
            onKeyDown={onPlacesKeyDown}
          >
            {placeLists}
          </nav>
        </StudioSidebarRail>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <ContextMenu onOpenChange={setIsMenuOpen}>
          <ContextMenuTrigger asChild>
            <div
              className="relative min-h-0 flex-1"
              // A middle click on a row opens it in a tab of its own, waiting
              // behind, the way Open in New Tab does: a double-click is what
              // opens one here, since a single click selects.
              onAuxClick={(event) => {
                if (event.button !== 1 || !(event.target instanceof Element)) {
                  return;
                }
                const itemPath = event.target
                  .closest("[data-file-system-item]")
                  ?.getAttribute("data-file-system-item");
                const item = items.find((entry) => entry.path === itemPath);
                if (item) {
                  event.preventDefault();
                  menuActionsFor(item).onOpenInNewTab();
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
              {isCurrentNotPermitted && folderHostPath !== undefined && (
                <NotPermitted
                  hostPath={folderHostPath}
                  onGranted={(granted) => {
                    reread();
                    if (granted !== folderHostPath) {
                      rootTo(granted);
                    }
                  }}
                />
              )}
              <FileSystem
                className="h-full rounded-none border-0"
                columnWidth={columnWidth}
                contextMenuPath={isMenuOpen ? (menuItem?.path ?? null) : null}
                defaultPath={path}
                defaultSelectedPath={select}
                // Every row here is a thing on this computer, and drags out of
                // the window as one: to the desktop, a Finder window, another
                // app. What lands there is the OS's copy; nothing here moves.
                getHostPath={(item) => hostPathOfItem(item) || undefined}
                items={items}
                key={`${root}#${openings}`}
                listColumns={listColumns}
                listColumnWidths={listColumnWidths}
                loadChildren={async ({ path: prefix }) => {
                  // The recents are one flat list of files; nothing on it opens.
                  if (isRecents) {
                    return { items: [] };
                  }
                  setLoaded((previous) =>
                    previous.root === root && previous.prefixes.includes(prefix)
                      ? previous
                      : {
                          prefixes:
                            previous.root === root
                              ? [...previous.prefixes, prefix]
                              : [...prefixesOf(path), prefix],
                          root,
                        },
                  );
                  // A listing read ahead on hover, and still fresh, is the
                  // answer as it stands rather than a second read.
                  await queryClient.fetchQuery({
                    ...rpcClient.workspace.computer.list.queryOptions({
                      input: { id: WINDOW_ID, path: hostPathOf(prefix) },
                    }),
                    staleTime: REFRESH_MS,
                  });
                  // The entries arrive through `items`, re-read on the clock
                  // above, so the browser is handed none of its own to hold.
                  return { items: [] };
                }}
                // The selection walks the folder under Quick Look, which holds
                // the keyboard itself: a row taking it back would be taking it
                // out of the panel the user is looking at.
                moveFocusWithSelection={!quickLookOpen}
                onColumnWidthChange={setColumnWidth}
                onFileOpen={openFile}
                onOpenSeveral={(several) => {
                  openInTabs(several, { behind: false });
                }}
                onItemContextMenu={(item) => {
                  setMenuItem(item ?? undefined);
                }}
                onListColumnsChange={setListColumns}
                onListColumnWidthsChange={setListColumnWidths}
                onPathChange={setCurrent}
                onRenameCancel={() => {
                  setRenamingPath(null);
                }}
                onRenameCommit={(item, name) => {
                  setRenamingPath(null);
                  void rename(item, name);
                }}
                onRenameStart={(item) => {
                  setRenamingPath(item.path);
                }}
                onSelectionChange={(item, all) => {
                  setSelectedPath(item?.path ?? null);
                  setSelectedPaths(all.map((each) => each.path));
                }}
                onShowHiddenFilesChange={setShowHiddenFiles}
                onSortChange={sortBy}
                onViewChange={(view) => {
                  setDefaultView(view);
                  keepLook({ sort: shown.sort, view });
                }}
                pendingFolders={pendingFolders}
                // Resting on a folder reads it ahead, so opening it in place
                // is the listing already in hand.
                prefetchChildren={(prefix) => {
                  if (isRecents) {
                    return;
                  }
                  void queryClient.prefetchQuery({
                    ...rpcClient.workspace.computer.list.queryOptions({
                      input: { id: WINDOW_ID, path: hostPathOf(prefix) },
                    }),
                    staleTime: REFRESH_MS,
                  });
                }}
                renamingPath={renamingPath}
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
                renderHeaderActions={() => (
                  <FolderOverflowMenu
                    {...menuActionsFor(selectedItem)}
                    item={selectedItem}
                    onClosed={afterMenuClosed}
                  />
                )}
                renderHeaderPrimary={
                  askAbout && (selectedItem || folderOnScreenPath !== undefined)
                    ? () => {
                        const about =
                          selectedItems.length > 1
                            ? `${selectedItems.length} items`
                            : (segmentsOf(
                                hostPathOfItem(selectedItem) ||
                                  (folderOnScreenPath ?? ""),
                              ).at(-1) ?? "this folder");
                        return (
                          <GlyphButton
                            className={TOOLBAR_CONTROL_CLASSNAME}
                            onClick={() => {
                              draftAbout(
                                selectedItems.length > 0
                                  ? selectedItems
                                  : [selectedItem],
                              );
                            }}
                            size="sm"
                            title={`Ask about “${about}”`}
                          >
                            <span className="@max-lg/finder:sr-only">Ask</span>
                          </GlyphButton>
                        );
                      }
                    : undefined
                }
                selectedPath={selectedPath}
                showHiddenFiles={showHiddenFiles}
                sort={shown.sort}
                title={rootName}
                view={shown.view}
              />
            </div>
          </ContextMenuTrigger>
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
            sort={shown.sort}
          />
        </ContextMenu>
      </div>
    </div>
  );
}

/** What a row's menus do, by the menu's own components; see `FolderMenu`. */
type FolderMenuActions = {
  onCopyPath: () => void;
  onDuplicate: () => void;
  /** A draft with the row, or the folder its empty space is, picked to go with it; left out where no draft can be opened. */
  onNewDraft?: (() => void) | undefined;
  /** Left out where there is no folder to make one in. */
  onNewFolder: (() => void) | undefined;
  /** What a double-click does: a folder is gone into, a file opened here. */
  onOpen: () => void;
  /** A folder in a tab of its own, which is the Finder's first answer for one. */
  onOpenInNewTab: () => void;
  /** Left out where nothing shows a file over the page. */
  onQuickLook: (() => void) | undefined;
  /** Left out where there is no field to type a name in. */
  onRename?: () => void;
  onReveal: () => void;
  onTrash: () => void;
  /**
   * What the menu acts on, when it is several selected: what names one thing
   * (Rename, Copy Path, Quick Look, Open With, Reveal) is left off.
   */
  group?: FileSystemItem[] | undefined;
};

/**
 * What can be done to the thing under the pointer, or to the folder itself
 * where there is nothing under it, in the order the Finder's own menu puts
 * them: opening first, the Trash apart, then what changes the thing, then
 * where it is. Handing a file to another program is one row, and a submenu
 * wherever the Mac can name the apps that read it, a folder's included: naming an app on the row
 * itself makes the menu as wide as whatever app that file happens to belong
 * to.
 */
export function FolderMenu({
  isRecents = false,
  onClosed,
  onSortKey,
  sort,
  ...props
}: FolderMenuActions & {
  isRecents?: boolean;
  item: FileSystemItem | undefined;
  /** The menu gone, and the keyboard with it. */
  onClosed?: () => void;
  /** With `sort`, the folder's own orders, offered on its empty space. */
  onSortKey?: (key: FileSystemSortKey) => void;
  sort?: FileSystemSortState;
}) {
  return (
    <ContextMenuContent
      className="min-w-48"
      // Closing hands the keyboard back to what the menu came up over, which
      // lands after a chosen action has already put it somewhere of its own:
      // in the name field a rename just opened, or on the browser. Every item
      // here says where the keyboard goes, so the menu says nothing.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onClosed?.();
      }}
    >
      <FolderMenuItems
        {...props}
        emptyTail={
          onSortKey && sort ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <SortAscendingIcon className="size-4" />
                <span>Sort By</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-44">
                <ContextMenuRadioGroup
                  onValueChange={(key) => {
                    const option = SORT_BY.find((entry) => entry.key === key);
                    if (option) {
                      onSortKey(option.key);
                    }
                  }}
                  value={sort.key}
                >
                  {SORT_BY.filter(
                    (option) => isRecents || !option.recentsOnly,
                  ).map((option) => (
                    <ContextMenuRadioItem key={option.key} value={option.key}>
                      {option.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null
        }
        menuComponents={contextMenuComponents}
      />
    </ContextMenuContent>
  );
}

/**
 * The toolbar's More menu, the Finder's ⋯: the folder menu for what is
 * selected, or for the folder where nothing is, with New Folder at its head
 * either way, since a list with no empty space to right-click still needs a
 * way to make one.
 */
function FolderOverflowMenu({
  onClosed,
  ...props
}: FolderMenuActions & {
  item: FileSystemItem | undefined;
  onClosed: () => void;
}) {
  return (
    <DropdownMenu>
      <ToolbarTooltip label="More">
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More"
            className={TOOLBAR_ICON_BUTTON_CLASSNAME}
            type="button"
          >
            <DotsThreeIcon className="size-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        <FolderMenuItems
          {...props}
          menuComponents={dropdownMenuComponents}
          newFolderFirst
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The folder menu's rows, drawn by whichever menu holds them. */
function FolderMenuItems({
  emptyTail,
  item,
  menuComponents,
  newFolderFirst = false,
  onCopyPath,
  onDuplicate,
  onNewDraft,
  onNewFolder,
  onOpen,
  onOpenInNewTab,
  onQuickLook,
  onRename,
  onReveal,
  onTrash,
  group,
}: FolderMenuActions & {
  /** What the menu adds on the folder's empty space, after New Folder. */
  emptyTail?: ReactNode;
  item: FileSystemItem | undefined;
  menuComponents: MenuComponents;
  /** New Folder at the head whatever the menu is about, the way the Finder's ⋯ has it. */
  newFolderFirst?: boolean;
}) {
  const { Item, Separator } = menuComponents;
  const tab = item?.kind === "file" ? fileTabOf(item) : undefined;
  const several = group?.length;
  const file = tab && !several ? { hostPath: tab.hostPath } : undefined;
  const openFile = useOpenFile();
  const { openLabel, showOpen } = useFileOpenTarget(file);
  const itemHostPath = several ? "" : hostPathOfItem(item);
  const openIn =
    isMacOS() && itemHostPath ? { hostPath: itemHostPath } : undefined;
  return (
    <>
      {newFolderFirst && onNewFolder ? (
        <>
          <Item onClick={onNewFolder}>
            <FolderPlusIcon className="size-4" />
            <span>New Folder</span>
          </Item>
          <Separator />
        </>
      ) : null}
      {onNewDraft ? (
        <>
          <Item onClick={onNewDraft}>
            <InstrumentGlyph className="size-4 text-brand-600 dark:text-brand-400" />
            <span>Ask</span>
          </Item>
          {/* Nothing comes after it on a folder's More menu. */}
          {item || !newFolderFirst ? <Separator /> : null}
        </>
      ) : null}
      {item ? (
        <>
          {(item.kind === "file" || several) && (
            <Item onClick={onOpen}>
              <FolderOpenIcon className="size-4" />
              <span>Open</span>
            </Item>
          )}
          <Item onClick={onOpenInNewTab}>
            <NewTabIcon className="size-4" />
            <span>{several ? "Open in New Tabs" : "Open in New Tab"}</span>
          </Item>
          {/* The apps are listed where the Mac can be asked for them, and the
                submenu asks only once it is opened, so the row is there from
                the first frame rather than arriving under the pointer once a
                lookup has answered. Elsewhere the one row hands the file to
                whichever program the system has chosen for it. */}
          {openIn ? (
            <OpenInMenu file={openIn} menuComponents={menuComponents} />
          ) : file && showOpen ? (
            <Item
              onClick={() => {
                openFile(file);
              }}
            >
              <OpenTargetIcon className="size-4" file={file} />
              <span>{openLabel}</span>
            </Item>
          ) : null}
          <Separator />
          <Item onClick={onTrash} variant="destructive">
            <TrashIcon className="size-4" />
            <span>Move to Trash</span>
          </Item>
          <Separator />
          {onRename ? (
            <Item onClick={onRename}>
              <PencilSimpleIcon className="size-4" />
              <span>Rename</span>
            </Item>
          ) : null}
          <Item onClick={onDuplicate}>
            <CopyIcon className="size-4" />
            <span>Duplicate</span>
          </Item>
          {file && onQuickLook ? (
            <Item onClick={onQuickLook}>
              <EyeIcon className="size-4" />
              <span>Quick Look</span>
            </Item>
          ) : null}
          {/* Where one thing is has no answer for several. */}
          {several ? null : (
            <>
              <Separator />
              <Item onClick={onCopyPath}>
                <ClipboardTextIcon className="size-4" />
                <span>Copy Path</span>
              </Item>
              {/* The Open in list already offers the Finder, so a row of its
                    own would name it twice. */}
              {openIn ? null : (
                <Item onClick={onReveal}>
                  <RevealInFolderIcon className="size-4" />
                  <span>{getRevealInFolderLabel()}</span>
                </Item>
              )}
            </>
          )}
        </>
      ) : (
        <>
          {onNewFolder && !newFolderFirst ? (
            <>
              <Item onClick={onNewFolder}>
                <FolderPlusIcon className="size-4" />
                <span>New Folder</span>
              </Item>
              <Separator />
            </>
          ) : null}
          {emptyTail}
        </>
      )}
    </>
  );
}

/**
 * Stable while nothing changed: what each query holds, and only that, so a
 * re-render that fetched nothing new hands the browser the same items. A
 * folder that could not be read travels with them, since the one asking is
 * the only one that can stop asking.
 */
function combineListings(
  results: {
    data: ComputerListing | undefined;
    error: unknown;
    isError: boolean;
    isPending: boolean;
  }[],
) {
  return results.map((result) => ({
    data: result.data,
    error: result.error,
    isError: result.isError,
    isPending: result.isPending,
  }));
}

/** What went wrong with a file action, said where the folder is. */
function failed(error: unknown) {
  toast(error instanceof Error ? error.message : "That did not work");
}

/** Where an item the browser is showing sits on the Mac. */
function hostPathOfItem(item: FileSystemItem | undefined) {
  const hostPath = item?.metadata?.hostPath;
  return typeof hostPath === "string" ? hostPath : "";
}

/** Whether a listing failed because the operating system refused the read. */
function isNotPermitted(error: unknown) {
  return error instanceof ORPCError && error.code === "NOT_PERMITTED";
}

/**
 * The folder the system would not let this app read, and the two ways to
 * let it. The system's own panel is the graceful one: a folder picked there
 * is the person's intent, which the Mac honors without asking again, so the
 * panel opens at the folder itself and the answer is one press. The settings
 * pane is where a declined ask is undone for good.
 */
function NotPermitted({
  hostPath,
  onGranted,
}: {
  hostPath: string;
  /** The folder the person picked in the panel, which is usually this one. */
  onGranted: (hostPath: string) => void;
}) {
  const name = segmentsOf(hostPath).at(-1) ?? hostPath;
  const choose = useMutation({
    mutationFn: () =>
      rpcClient.utils.showFolderPicker.call({
        buttonLabel: "Open",
        message: `Instrument can’t read “${name}” until you open it here.`,
        startingAt: hostPath,
      }),
    onSuccess: (picked) => {
      if (picked) {
        onGranted(picked.path);
      }
    },
  });
  const openSettings = useMutation(
    rpcClient.features.openFilesAndFoldersSettings.mutationOptions(),
  );
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <FileSystemFolderGlyph className="h-10 w-auto opacity-60" />
        <div>
          <p className="text-sm font-medium">
            {isMacOS() ? "macOS" : "Your computer"} hasn’t let Instrument read “
            {name}”
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Open the folder in the system’s own panel to read it now
            {isMacOS()
              ? ", or allow it under Files and Folders in System Settings."
              : "."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              choose.mutate();
            }}
            size="sm"
          >
            Choose the folder…
          </Button>
          {isMacOS() && (
            <Button
              onClick={() => {
                openSettings.mutate(undefined);
              }}
              size="sm"
              variant="outline"
            >
              Open System Settings
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

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
 * What the browser knows each recent file by. Its own name for almost every
 * one of them, which holds still as the list is read again; where two folders
 * hold the same name, the later of the two is told apart by where it sits.
 */
function recentPaths(entries: readonly { name: string }[]): string[] {
  const taken = new Set<string>();
  return entries.map((entry, index) => {
    const path = taken.has(entry.name)
      ? `${entry.name} (${index})`
      : entry.name;
    taken.add(path);
    return path;
  });
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
  fallbackAspect,
  src,
}: {
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
        "relative w-full overflow-hidden rounded-xl shadow-sm ring-1 ring-border",
        !isLoaded && "bg-muted",
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

/**
 * What has a picture rather than an icon, the way the Finder's icons show
 * one: pictures, documents with pages and video, which the system draws, and
 * pages, Markdown and code, which the app draws itself. Anything else would
 * come back as a blank page, which says less than the file's own type icon.
 */
const THUMBNAIL_EXTENSIONS = new Set([
  "ai",
  "bmp",
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "csv",
  "docx",
  "gif",
  "go",
  "h",
  "heic",
  "heif",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "jsx",
  "key",
  "kt",
  "log",
  "lua",
  "m4v",
  "markdown",
  "md",
  "mdx",
  "mjs",
  "mov",
  "mp4",
  "numbers",
  "pages",
  "pdf",
  "php",
  "png",
  "pptx",
  "psd",
  "py",
  "rb",
  "rs",
  "rtf",
  "scss",
  "sh",
  "sql",
  "svg",
  "swift",
  "tif",
  "tiff",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "webp",
  "xlsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

/** The tab a file opens in: the file by where it is on the computer. */
function fileTabOf(file: FileSystemFileItem): FileTab | undefined {
  const hostPath = file.metadata?.hostPath;
  if (typeof hostPath !== "string") {
    return;
  }
  return {
    hostPath,
    // A recents row carries its own name: what it is called where it lives,
    // rather than what the list knows it by.
    name: file.name ?? file.path.split("/").at(-1) ?? file.path,
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

function PlaceList({
  label,
  menu,
  onOpen,
  onOpenInNewTab,
  places,
}: {
  /** Left out for a list of one, where a heading says nothing the row does not. */
  label?: string;
  /** What a right-click on a place offers, left out where a place is not a folder. */
  menu?: (path: string) => ReactNode;
  onOpen: (path: string) => void;
  /** A middle click: the place in a tab of its own, waiting behind. */
  onOpenInNewTab: (path: string) => void;
  places: {
    icon: ReactNode;
    isActive: boolean;
    name: string;
    path: string;
  }[];
}) {
  return (
    <div>
      {label === undefined ? null : (
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground/70">
          {label}
        </p>
      )}
      <ul className="flex flex-col gap-px">
        {places.map((place) => (
          <li key={place.path}>
            <ContextMenu>
              <ContextMenuTrigger asChild disabled={menu === undefined}>
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-foreground/5 data-[state=open]:bg-foreground/5",
                    place.isActive && "bg-foreground/8",
                  )}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onOpenInNewTab(place.path);
                    }
                  }}
                  onClick={() => {
                    onOpen(place.path);
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                    }
                  }}
                  type="button"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {place.icon}
                  </span>
                  <span className="truncate">{place.name}</span>
                </button>
              </ContextMenuTrigger>
              {menu?.(place.path)}
            </ContextMenu>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What can be done to a place in the sidebar: the folder menu's ways of
 * opening it and pointing at it, and none of the ways of changing it. A place
 * is a folder a person keeps things in, and Rename, Duplicate or the Trash one
 * misplaced click away from the whole of it is not worth the row.
 */
function PlaceMenu({
  hostPath,
  onNewDraft,
  onOpenInNewTab,
}: {
  hostPath: string;
  /** Left out where no draft can be opened. */
  onNewDraft: (() => void) | undefined;
  onOpenInNewTab: () => void;
}) {
  return (
    <ContextMenuContent className="min-w-48">
      {onNewDraft ? (
        <>
          <ContextMenuItem onClick={onNewDraft}>
            <InstrumentGlyph className="size-4 text-brand-600 dark:text-brand-400" />
            <span>Ask</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem onClick={onOpenInNewTab}>
        <NewTabIcon className="size-4" />
        <span>Open in New Tab</span>
      </ContextMenuItem>
      {/* The Open in list already offers the Finder, so a row of its own
          would name it twice. */}
      {isMacOS() ? (
        <OpenInMenu
          file={{ hostPath }}
          menuComponents={contextMenuComponents}
        />
      ) : (
        <ContextMenuItem
          onClick={() =>
            void rpcClient.utils.showFileInFolder
              .call({ filepath: hostPath })
              .catch(failed)
          }
        >
          <RevealInFolderIcon className="size-4" />
          <span>{getRevealInFolderLabel()}</span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() =>
          void navigator.clipboard.writeText(hostPath).catch(failed)
        }
      >
        <ClipboardTextIcon className="size-4" />
        <span>Copy Path</span>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * A listed file's own URL, and the system's picture of it where there is one,
 * named by when the file was written so a new write is a new picture.
 */
function previewOf(
  entry: {
    mimeType?: string;
    modifiedAt?: number;
    name: string;
    path: string;
  },
  theme: "dark" | "light",
): Pick<FileSystemFileItem, "previewImageUrl" | "url"> {
  const version = entry.modifiedAt;
  const url = getComputerFileUrl({ hostPath: entry.path, version });
  const extension = entry.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (
    !entry.mimeType?.startsWith("image/") &&
    !THUMBNAIL_EXTENSIONS.has(extension)
  ) {
    return { url };
  }
  return {
    previewImageUrl: getComputerThumbnailUrl({
      hostPath: entry.path,
      size: 512,
      theme,
      version,
    }),
    url,
  };
}

/**
 * Puts the Finder's sidebar of places away and brings it back, the way the
 * tree beside a file is toggled.
 */
function PlacesToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Hide the sidebar" : "Show the sidebar";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={isOpen}
        className={toolbarClassName({ className: "shrink-0", pressed: false })}
        onClick={onToggle}
        size="icon-sm"
        variant="ghost"
      >
        <SidebarSimpleIcon className="size-4" />
      </Button>
    </ToolbarTooltip>
  );
}

/**
 * Whether the Finder is too narrow to keep its places beside the folder: the
 * width a container query of `@xl` names, measured, since the toggle that
 * answers to it is drawn in the tab's row, outside the container.
 */
function useIsNarrow(frame: HTMLElement | null) {
  const [isNarrow, setIsNarrow] = useState(false);
  useLayoutEffect(() => {
    if (!frame) {
      return;
    }
    const measure = () => {
      // Layout px, the units the container query reads, whatever the zoom.
      setIsNarrow(frame.offsetWidth < NARROW_FINDER_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => {
      observer.disconnect();
    };
  }, [frame]);
  return isNarrow;
}
