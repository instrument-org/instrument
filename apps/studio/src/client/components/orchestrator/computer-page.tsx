import {
  computerHiddenFilesAtom,
  computerViewAtom,
  type FileTab,
} from "@/client/atoms/orchestrator";
import {
  FileSystem,
  type FileSystemFileItem,
  FileSystemFolderGlyph,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { FileViewer } from "@/client/components/file-viewer";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { OpenTargetIcon } from "@/client/components/open-target-icon";
import { OpenWithMenu } from "@/client/components/open-with-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useOpenTaskFile } from "@/client/hooks/use-open-task-file";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn, getRevealInFolderLabel, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ComputerListing,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ClipboardTextIcon } from "@phosphor-icons/react/ClipboardText";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { FolderPlusIcon } from "@phosphor-icons/react/FolderPlus";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import ms from "ms";
import { unique } from "radashi";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";
import { folderOf, homeRelative, joinHostPath, segmentsOf } from "./host-path";

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

/** The folder the user is looking at, for the conversation. */
export interface FolderOnScreen {
  /** Whether the agent may write there, when it can reach it at all. */
  access?: "read-only" | "read-write";
  /** As the person writes it: `~/Documents`. */
  display: string;
  hostPath: string;
  /** How the agent reaches it, when a granted folder covers it. */
  mount?: string;
  /** Names selected in it. */
  selected: string[];
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
}: {
  /** Told the folder on screen whenever it changes. */
  onFolderChange?: (folder: FolderOnScreen) => void;
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
}) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Held above the browser, which is rebuilt on every opening, so the layout
  // and the dotfiles answer survive walking into the next folder.
  const [view, setView] = useAtom(computerViewAtom);
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
      input: { id: taskId },
      refetchInterval:
        refreshInterval === false
          ? false
          : Math.max(refreshInterval, RECENTS_REFRESH_MS),
    }),
  );
  const homePath = places.data?.favorites.find(
    (place) => place.name === "Home",
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
  const [selectedPath, setSelectedPath] = useState<null | string>(null);
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
  useEffect(() => {
    const here = `${root}#${path}`;
    const [writtenRoot] = written.current.split("#");
    if (written.current === here) {
      return;
    }
    const rootChanged = root !== writtenRoot;
    written.current = here;
    setCurrent(path);
    setSelectedPath(null);
    setLoaded((previous) => ({
      prefixes: rootChanged
        ? prefixesOf(path)
        : unique([...previous.prefixes, ...prefixesOf(path)]),
      root,
    }));
    setOpenings((count) => count + 1);
  }, [path, root]);

  // `~` names the home folder, which the workspace expands for a folder it is
  // being asked to read. Nothing else does: a path this hands to an action
  // reaches the filesystem as it is, so those pass the expanded root instead.
  // The browser's own prefixes are written with slashes whatever computer this
  // is, so the names are taken out of one and spelled the way the root is.
  const hostPathOf = (prefix: string, base = root) =>
    joinHostPath(base, prefix);

  // What the folder's own menu is open on. Nothing means the menu came up on
  // the folder's empty space, where the only thing to do is make something.
  const [menuItem, setMenuItem] = useState<FileSystemItem>();
  // The item whose name is being typed over, by the path the browser knows it
  // by; the row itself holds the field.
  const [renamingPath, setRenamingPath] = useState<null | string>(null);

  const listings = useQueries({
    combine: combineListings,
    queries: isRecents
      ? []
      : prefixes.map((prefix) =>
          rpcClient.workspace.computer.list.queryOptions({
            input: { id: taskId, path: hostPathOf(prefix) },
            refetchInterval: refreshInterval,
            retry: false,
          }),
        ),
  });
  // A folder that has gone (thrown away here, moved in the Finder) is asked
  // for on the clock until it is let go of, which is a failing read every few
  // seconds for as long as the screen is up. Opening it again brings it back.
  const goneFolder = prefixes.find(
    (prefix, index) => prefix !== "" && listings[index]?.isError,
  );
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
  const assetBase = getAssetBaseUrl(taskId);
  // The recents as a folder's worth of files: named where they live, and flat,
  // since a list of what was shown is not a tree.
  const recentEntries = recents.data ?? [];
  const recentKeys = recentPaths(recentEntries);
  const recentItems = recentEntries.map((entry, index): FileSystemItem => {
    const mount = entry.access?.mountPath;
    const url =
      mount === undefined
        ? undefined
        : getAssetUrl({
            assetBase,
            filePath: mount,
            version: entry.modifiedAt,
          });
    return {
      contentType: entry.mimeType,
      ...(entry.createdAt === undefined
        ? {}
        : { createdAt: new Date(entry.createdAt).toISOString() }),
      kind: "file",
      metadata: {
        hostPath: entry.path,
        ...(mount === undefined ? {} : { mount }),
      },
      name: entry.name,
      path: recentKeys[index] ?? entry.name,
      ...(url && entry.mimeType?.startsWith("image/")
        ? { previewImageUrl: url, url }
        : url
          ? { url }
          : {}),
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
              hasChildren: true,
              kind: "folder",
              metadata: { hostPath: entry.path },
              path: `${prefix}${entry.name}/`,
            };
          }
          const mount = data.access
            ? `${data.access.mountPath}/${entry.name}`
            : undefined;
          const url =
            mount === undefined
              ? undefined
              : getAssetUrl({
                  assetBase,
                  filePath: mount,
                  version: entry.modifiedAt,
                });
          return {
            ...stamps,
            contentType: entry.mimeType,
            kind: "file",
            metadata: { hostPath: entry.path, ...(mount ? { mount } : {}) },
            path: `${prefix}${entry.name}`,
            ...(url && entry.mimeType?.startsWith("image/")
              ? { previewImageUrl: url, url }
              : url
                ? { url }
                : {}),
            size: entry.size,
          };
        })
    );
  });
  const items = isRecents ? recentItems : folderItems;
  const selectedItem =
    selectedPath === null
      ? undefined
      : items.find((item) => item.path === selectedPath);
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
  const duplicate = async (item: FileSystemItem | undefined) => {
    const hostPath = hostPathOfItem(item);
    if (!item || !hostPath) {
      return;
    }
    try {
      const copy = await rpcClient.files.duplicate.call({ path: hostPath });
      // The copy is what the Finder leaves selected, and where the keyboard
      // carries on from.
      setSelectedPath(
        siblingPath(item.path, copy.path.split("/").at(-1) ?? ""),
      );
      focusBrowser();
      reread();
    } catch (error) {
      failed(error);
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
  const trash = async (item: FileSystemItem | undefined) => {
    const hostPath = hostPathOfItem(item);
    if (!hostPath) {
      return;
    }
    try {
      await rpcClient.files.trash.call({ path: hostPath });
      setSelectedPath(null);
      focusBrowser();
      reread();
    } catch (error) {
      failed(error);
    }
  };

  const listingOf = (prefix: string) =>
    listings[prefixes.indexOf(prefix)]?.data;
  // The folder on screen: in columns, a selected folder shows its contents in
  // the next column, so it is the one the user is looking at; a selected file
  // is in the folder that lists it; nothing selected leaves the browser's own.
  const onScreen =
    selectedPath === null
      ? current
      : selectedPath.endsWith("/")
        ? selectedPath
        : selectedPath.slice(0, selectedPath.lastIndexOf("/") + 1);
  const currentListing = listingOf(onScreen);
  // Whether the folder the page is holding belongs to the root it was handed.
  // A new root arrives a render ahead of the reset that clears the folder
  // under it, and writing the address in between paired the root being opened
  // with the folder being left: an address to a folder that is not there,
  // written to history for the back button to return to.
  const settled = loaded.root === root;
  useEffect(() => {
    if (!settled || onScreen === path) {
      return;
    }
    written.current = `${root}#${onScreen}`;
    if (onLocationChange) {
      onLocationChange({ path: onScreen, root });
      return;
    }
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, path: onScreen, root }),
      to: "/orchestrator/computer",
    });
  }, [navigate, onLocationChange, onScreen, path, root, settled]);

  // The arrows work the moment a folder is on screen: the first row takes
  // the keyboard on each opening, unless the user is typing somewhere.
  const hasRows = items.length > 0;
  useEffect(() => {
    if (!hasRows || isTypingTarget(document.activeElement)) {
      return;
    }
    const row = browserRef.current?.querySelector<HTMLElement>(
      '[role="option"][tabindex="0"]',
    );
    row?.focus({ preventScroll: true });
    // Once per opening, when its rows are first there.
  }, [openings, hasRows]);

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

  // The folders this tab has shown, in order, for back and forward the way
  // the Finder's are: a step back is a folder, never a screen the window was
  // on. A folder reached by back or forward is not pushed again.
  const trail = useRef<{ at: number; folders: string[] }>({
    at: 0,
    folders: [`${root}#${path}`],
  });
  const walking = useRef(false);
  useEffect(() => {
    if (!settled) {
      return;
    }
    const here = `${root}#${onScreen}`;
    const { at, folders } = trail.current;
    if (folders[at] === here) {
      return;
    }
    if (walking.current) {
      walking.current = false;
      return;
    }
    trail.current = {
      at: at + 1,
      folders: [...folders.slice(0, at + 1), here],
    };
  }, [onScreen, root, settled]);

  // What the conversation is told "this folder" means. At the recents that is
  // where the selected file lives, since the list itself is nowhere; with
  // nothing selected there, there is no folder to name.
  const recentFolder = selectedRecent
    ? folderOf(selectedRecent.path)
    : undefined;
  const display = isRecents
    ? recentFolder && homeRelative(recentFolder, homePath)
    : currentListing?.display;
  const hostPath = isRecents ? recentFolder : currentListing?.path;
  const mount = isRecents
    ? selectedRecent?.access && folderOf(selectedRecent.access.mountPath)
    : currentListing?.access?.mountPath;
  const access = isRecents
    ? selectedRecent?.access?.access
    : currentListing?.access?.access;
  const selectedName =
    selectedPath !== null && !selectedPath.endsWith("/")
      ? (selectedItem?.name ?? selectedPath.split("/").at(-1))
      : undefined;
  useEffect(() => {
    if (display === undefined || hostPath === undefined) {
      return;
    }
    onFolderChange?.({
      ...(access === undefined ? {} : { access }),
      display,
      hostPath,
      ...(mount === undefined ? {} : { mount }),
      selected: selectedName ? [selectedName] : [],
    });
  }, [access, display, hostPath, mount, onFolderChange, selectedName]);

  const openFile = async (file: FileSystemFileItem) => {
    const tab = fileTabOf(file);
    if (tab) {
      onOpenFile(tab);
      return;
    }
    const filepath = file.metadata?.hostPath;
    if (typeof filepath !== "string") {
      return;
    }
    try {
      await rpcClient.utils.openPath.call({ filepath });
    } catch (error) {
      toast.error("Could not open the file", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Space on a selected file, the way the Finder shows one over everything.
  const selectedFile = selectedItem?.kind === "file" ? selectedItem : undefined;
  const quickLookTab = selectedFile ? fileTabOf(selectedFile) : undefined;
  const quickLookKey = quickLookTab?.mount;
  useEffect(() => {
    // No panel to show one in, no key taken from the rest of the page.
    if (!quickLookTab || !onQuickLook) {
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
  }, [quickLookKey, onQuickLook]);

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
      const row =
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

  const rootTo = (folder: string, prefix = "") => {
    if (onLocationChange) {
      onLocationChange({ path: prefix, root: folder });
      return;
    }
    void navigate({
      search: { path: prefix, root: folder },
      to: "/orchestrator/computer",
    });
  };

  const walk = (direction: -1 | 1) => {
    const { at, folders } = trail.current;
    const next = folders[at + direction];
    if (next === undefined) {
      return;
    }
    walking.current = true;
    trail.current = { at: at + direction, folders };
    const [nextRoot = root, nextPath = ""] = next.split("#");
    rootTo(nextRoot, nextPath);
  };

  if (!places.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  // The recents are rooted nowhere, so no place in the list is the one open.
  const rootHostPath = isRecents ? undefined : root === "~" ? homePath : root;
  const rootName = isRecents
    ? "Recents"
    : root === "~"
      ? "Home"
      : (segmentsOf(root).at(-1) ?? places.data.volumes[0]?.name ?? "Root");
  // The folder on screen, which is the only row the sidebar marks: a place
  // walked down out of is no longer where the user is, so nothing is marked
  // until a folder is one of the places itself.
  const folderHostPath = isRecents
    ? undefined
    : (currentListing?.path ?? hostPathOf(onScreen, rootHostPath ?? root));
  return (
    <div className="flex h-full min-h-0">
      <nav
        className="flex w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border px-2 py-2 text-sm"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") {
            return;
          }
          event.preventDefault();
          enterListing();
        }}
      >
        {/* What the conversation showed, before the places a person keeps things. */}
        <PlaceList
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
          onOpen={(folder) => {
            rootTo(folder === homePath ? "~" : folder);
          }}
          places={places.data.favorites.map((place) => ({
            icon:
              place.name === "Instrument" ? (
                // Everything made here, under the mark of what made it.
                <InstrumentGlyph className="size-4 text-muted-foreground" />
              ) : (
                <FileSystemFolderGlyph className="h-3.5 w-auto" />
              ),
            isActive: folderHostPath === place.path,
            name: place.name,
            path: place.path,
          }))}
        />
        <PlaceList
          label="Locations"
          onOpen={(folder) => {
            rootTo(folder);
          }}
          places={places.data.volumes.map((volume) => ({
            icon: <HardDriveIcon className="size-4 text-muted-foreground" />,
            isActive: folderHostPath === volume.path,
            name: volume.name,
            path: volume.path,
          }))}
        />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="min-h-0 flex-1" ref={browserRef}>
              <FileSystem
                className="h-full rounded-none border-0"
                defaultPath={path}
                // The recents open in the order they were handed over, most
                // recently shown first, which is the order the user met them
                // in; anywhere else the browser's own name order is what a
                // folder is expected to be in.
                {...(isRecents
                  ? {
                      defaultSort: {
                        direction: "desc" as const,
                        key: "shownAt" as const,
                      },
                    }
                  : {})}
                items={items}
                key={`${root}#${openings}`}
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
                  await queryClient.fetchQuery(
                    rpcClient.workspace.computer.list.queryOptions({
                      input: { id: taskId, path: hostPathOf(prefix) },
                    }),
                  );
                  // The entries arrive through `items`, re-read on the clock
                  // above, so the browser is handed none of its own to hold.
                  return { items: [] };
                }}
                // The selection walks the folder under Quick Look, which holds
                // the keyboard itself: a row taking it back would be taking it
                // out of the panel the user is looking at.
                moveFocusWithSelection={!quickLookOpen}
                onFileOpen={(file) => {
                  void openFile(file);
                }}
                onItemContextMenu={(item) => {
                  setMenuItem(item ?? undefined);
                }}
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
                onSelectionChange={(item) => {
                  setSelectedPath(item?.path ?? null);
                }}
                onShowHiddenFilesChange={setShowHiddenFiles}
                onViewChange={setView}
                renamingPath={renamingPath}
                renderFileStage={(file) => {
                  // Text reads as a thumbnail of the document, the way an image
                  // does; the viewers the browser has of its own cover the rest.
                  const tab = fileTabOf(file);
                  if (!tab || !isTextLike(file)) {
                    return null;
                  }
                  return (
                    <DocumentThumbnail key={tab.mount}>
                      <FileViewer
                        className="h-full"
                        file={{
                          filename: tab.name,
                          filePath: tab.mount,
                          taskId,
                          url: getAssetUrl({ assetBase, filePath: tab.mount }),
                        }}
                      />
                    </DocumentThumbnail>
                  );
                }}
                renderHeaderLead={() => (
                  <span className="flex items-center gap-0.5 pr-1">
                    <button
                      aria-label="Back"
                      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                      disabled={trail.current.at === 0}
                      onClick={() => {
                        walk(-1);
                      }}
                      type="button"
                    >
                      <CaretLeftIcon className="size-4" />
                    </button>
                    <button
                      aria-label="Forward"
                      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                      disabled={
                        trail.current.at >= trail.current.folders.length - 1
                      }
                      onClick={() => {
                        walk(1);
                      }}
                      type="button"
                    >
                      <CaretRightIcon className="size-4" />
                    </button>
                  </span>
                )}
                selectedPath={selectedPath}
                showHiddenFiles={showHiddenFiles}
                title={rootName}
                view={view}
              />
            </div>
          </ContextMenuTrigger>
          <FolderMenu
            item={menuItem}
            onCopyPath={() => void copyPath(menuItem)}
            onDuplicate={() => void duplicate(menuItem)}
            // The recents are a list rather than a folder, so there is nowhere
            // there to make one.
            onNewFolder={
              isRecents
                ? undefined
                : () => {
                    void newFolderIn({
                      // The listing knows the folder's own path; until it has
                      // arrived, the root the sidebar resolved stands in for it.
                      hostPath:
                        currentListing?.path ??
                        hostPathOf(onScreen, rootHostPath ?? root),
                      prefix: onScreen,
                    });
                  }
            }
            onRename={() => {
              setRenamingPath(menuItem?.path ?? null);
            }}
            onReveal={() =>
              void rpcClient.utils.showFileInFolder
                .call({ filepath: hostPathOfItem(menuItem) })
                .catch(failed)
            }
            onTrash={() => void trash(menuItem)}
            taskId={taskId}
          />
        </ContextMenu>
      </div>
    </div>
  );
}

/**
 * Stable while nothing changed: what each query holds, and only that, so a
 * re-render that fetched nothing new hands the browser the same items. A
 * folder that could not be read travels with them, since the one asking is
 * the only one that can stop asking.
 */
function combineListings(
  results: { data: ComputerListing | undefined; isError: boolean }[],
) {
  return results.map((result) => ({
    data: result.data,
    isError: result.isError,
  }));
}

/** What went wrong with a file action, said where the folder is. */
function failed(error: unknown) {
  toast(error instanceof Error ? error.message : "That did not work");
}

/**
 * What can be done to the thing under the pointer, or to the folder itself
 * where there is nothing under it. Handing a file to another program is one
 * row, and a submenu wherever the Mac can name the apps that read it: naming
 * an app on the row itself makes the menu as wide as whatever app that file
 * happens to belong to, and puts leaving the app at the top of the list of
 * things to do with a file.
 */
function FolderMenu({
  item,
  onCopyPath,
  onDuplicate,
  onNewFolder,
  onRename,
  onReveal,
  onTrash,
  taskId,
}: {
  item: FileSystemItem | undefined;
  onCopyPath: () => void;
  onDuplicate: () => void;
  /** Left out where there is no folder to make one in. */
  onNewFolder: (() => void) | undefined;
  onRename: () => void;
  onReveal: () => void;
  onTrash: () => void;
  taskId: TaskId;
}) {
  const tab = item?.kind === "file" ? fileTabOf(item) : undefined;
  const file = tab ? { filePath: tab.mount, taskId } : undefined;
  const openTaskFile = useOpenTaskFile();
  const { showOpen } = useTaskFileOpenTarget(file);
  return (
    <ContextMenuContent
      className="min-w-48"
      // Closing hands the keyboard back to what the menu came up over, which
      // lands after a chosen action has already put it somewhere of its own:
      // in the name field a rename just opened, or on the browser. Every item
      // here says where the keyboard goes, so the menu says nothing.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
      }}
    >
      {/* The apps are listed where the Mac can be asked for them, and the
          submenu asks only once it is opened, so the row is there from the
          first frame rather than arriving under the pointer once a lookup has
          answered. Elsewhere the one row hands the file to whichever program
          the system has chosen for it. */}
      {file && isMacOS() ? (
        <>
          <OpenWithMenu file={file} menuComponents={contextMenuComponents} />
          <ContextMenuSeparator />
        </>
      ) : file && showOpen ? (
        <>
          <ContextMenuItem
            onClick={() => {
              openTaskFile(file);
            }}
          >
            <OpenTargetIcon className="size-4" file={file} />
            <span>Open</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      {item ? (
        <>
          <ContextMenuItem onClick={onReveal}>
            <RevealInFolderIcon className="size-4" />
            <span>{getRevealInFolderLabel()}</span>
          </ContextMenuItem>
          <ContextMenuItem onClick={onCopyPath}>
            <ClipboardTextIcon className="size-4" />
            <span>Copy Path</span>
          </ContextMenuItem>
        </>
      ) : null}
      {onNewFolder ? (
        <ContextMenuItem onClick={onNewFolder}>
          <FolderPlusIcon className="size-4" />
          <span>New folder</span>
        </ContextMenuItem>
      ) : null}
      {item ? (
        <>
          <ContextMenuItem onClick={onRename}>
            <PencilSimpleIcon className="size-4" />
            <span>Rename</span>
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicate}>
            <CopyIcon className="size-4" />
            <span>Duplicate</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onTrash} variant="destructive">
            <TrashIcon className="size-4" />
            <span>Move to Trash</span>
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );
}

/** Where an item the browser is showing sits on the Mac. */
function hostPathOfItem(item: FileSystemItem | undefined) {
  const hostPath = item?.metadata?.hostPath;
  return typeof hostPath === "string" ? hostPath : "";
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

/** How much smaller than life a document is drawn in its thumbnail. */
const THUMBNAIL_SCALE = 0.4;

/**
 * A document at thumbnail size: the viewer drawn at full width and scaled
 * down into a page-shaped box, not interactive, clipped at the bottom the way
 * a page preview is. The viewer sees a box wide enough to lay itself out as
 * it would in a pane, so type and tables keep their shape at a smaller size.
 */
function DocumentThumbnail({ children }: { children: ReactNode }) {
  const inverse = `${100 / THUMBNAIL_SCALE}%`;
  return (
    // `contain-inline-size`: the box's own width says nothing about the
    // document in it, so a wide line in the viewer cannot widen the column
    // the thumbnail sits in.
    <div className="pointer-events-none aspect-[0.78] w-full overflow-hidden rounded-sm bg-card shadow-sm ring-1 ring-border contain-inline-size">
      {/* The viewer is laid out at the box's width divided by the scale and
          drawn scaled back down, so it fills the box edge to edge; what it
          lays out past the box's height is clipped, the way a page preview
          is. Its own chrome rows are hidden: a thumbnail is the document. */}
      <div
        className="origin-top-left [&_.viewer-chrome-stroke]:hidden"
        style={{
          height: inverse,
          transform: `scale(${THUMBNAIL_SCALE})`,
          width: inverse,
        }}
      >
        {children}
      </div>
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

/** The tab a file opens in, when a granted folder covers it. */
function fileTabOf(file: FileSystemFileItem): FileTab | undefined {
  const mounted = file.metadata?.mount;
  if (typeof mounted !== "string") {
    return;
  }
  const hostFile = file.metadata?.hostPath;
  return {
    ...(typeof hostFile === "string" ? { hostPath: hostFile } : {}),
    mount: mounted,
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
  onOpen,
  places,
}: {
  /** Left out for a list of one, where a heading says nothing the row does not. */
  label?: string;
  onOpen: (path: string) => void;
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
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-foreground/5",
                place.isActive && "bg-foreground/8",
              )}
              onClick={() => {
                onOpen(place.path);
              }}
              type="button"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {place.icon}
              </span>
              <span className="truncate">{place.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
