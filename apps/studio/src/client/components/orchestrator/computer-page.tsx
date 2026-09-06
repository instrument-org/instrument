import { type FileTab } from "@/client/atoms/orchestrator";
import {
  FileSystem,
  type FileSystemFileItem,
  FileSystemFolderGlyph,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { FileViewer } from "@/client/components/file-viewer";
import { OpenTaskFileButton } from "@/client/components/open-task-file-button";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useTaskFileOpenControl } from "@/client/hooks/use-task-file-open-control";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ComputerListing,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import ms from "ms";
import { unique } from "radashi";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";

/** How often every folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("4 seconds");

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
 * beside it; a text file reads in the last column. Under the columns, the
 * folder's whole path on the Mac, each part a way back up.
 *
 * The file browser holds a flat manifest and asks for a folder's children the
 * first time it is opened. Every folder it has asked for is re-read on a
 * clock, so what a task writes shows up without a refresh.
 */
export function ComputerPage({
  onFolderChange,
  onOpenFile,
  onQuickLook,
  onQuickLookFollow,
  path,
  quickLookOpen,
  root,
}: {
  /** Told the folder on screen whenever it changes. */
  onFolderChange: (folder: FolderOnScreen) => void;
  /** A file the user opened, when a granted folder covers it. */
  onOpenFile: (file: FileTab) => void;
  /** The selected file, on Space. */
  onQuickLook: (file: FileTab) => void;
  /** The file the selection moved to while Quick Look is up, for it to show. */
  onQuickLookFollow: (file: FileTab) => void;
  path: string;
  /** Whether Quick Look is up: the arrows then move the selection under it. */
  quickLookOpen: boolean;
  root: string;
}) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  // Folder prefixes under the root whose listings are held, root first. The
  // browser asks for a folder's children only once the folder is in its
  // index, so the folder it opens on needs every folder above it listed.
  const [loaded, setLoaded] = useState<readonly string[]>(() =>
    prefixesOf(path),
  );
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
    setLoaded((previous) =>
      rootChanged
        ? prefixesOf(path)
        : unique([...previous, ...prefixesOf(path)]),
    );
    setOpenings((count) => count + 1);
  }, [path, root]);

  // `~` names the home folder; the workspace expands it.
  const hostPathOf = (prefix: string) => {
    const folder = prefix.replace(/\/$/, "");
    return folder ? `${root}/${folder}` : root;
  };

  const listings = useQueries({
    combine: combineListings,
    queries: loaded.map((prefix) =>
      rpcClient.workspace.computer.list.queryOptions({
        input: { id: taskId, path: hostPathOf(prefix) },
        refetchInterval: REFRESH_MS,
      }),
    ),
  });
  const assetBase = getAssetBaseUrl(taskId);
  const items = listings.flatMap((data, index) => {
    const prefix = loaded[index] ?? "";
    if (!data) {
      return [];
    }
    return data.entries.map((entry): FileSystemItem => {
      if (entry.kind === "folder") {
        return {
          hasChildren: true,
          kind: "folder",
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
        contentType: entry.mimeType,
        kind: "file",
        metadata: { hostPath: entry.path, ...(mount ? { mount } : {}) },
        path: `${prefix}${entry.name}`,
        ...(entry.modifiedAt === undefined
          ? {}
          : { updatedAt: new Date(entry.modifiedAt).toISOString() }),
        ...(url && entry.mimeType?.startsWith("image/")
          ? { previewImageUrl: url, url }
          : url
            ? { url }
            : {}),
        size: entry.size,
      };
    });
  });

  const listingOf = (prefix: string) => listings[loaded.indexOf(prefix)];
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
  useEffect(() => {
    if (onScreen !== path) {
      written.current = `${root}#${onScreen}`;
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, path: onScreen, root }),
        to: "/orchestrator/computer",
      });
    }
  }, [navigate, onScreen, path, root]);

  // The arrows work the moment a folder is on screen: the first row takes
  // the keyboard on each opening, unless the user is typing somewhere.
  const browserRef = useRef<HTMLDivElement>(null);
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

  // The folders this tab has shown, in order, for back and forward the way
  // the Finder's are: a step back is a folder, never a screen the window was
  // on. A folder reached by back or forward is not pushed again.
  const trail = useRef<{ at: number; folders: string[] }>({
    at: 0,
    folders: [`${root}#${path}`],
  });
  const walking = useRef(false);
  useEffect(() => {
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
  }, [onScreen, root]);

  // What the conversation is told "this folder" means.
  const display = currentListing?.display;
  const hostPath = currentListing?.path;
  const mount = currentListing?.access?.mountPath;
  const access = currentListing?.access?.access;
  const selectedName =
    selectedPath !== null && !selectedPath.endsWith("/")
      ? selectedPath.split("/").at(-1)
      : undefined;
  useEffect(() => {
    if (display === undefined || hostPath === undefined) {
      return;
    }
    onFolderChange({
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
  const selectedFile =
    selectedPath === null
      ? undefined
      : items.find(
          (item): item is FileSystemFileItem =>
            item.kind === "file" && item.path === selectedPath,
        );
  const quickLookTab = selectedFile ? fileTabOf(selectedFile) : undefined;
  const quickLookKey = quickLookTab?.mount;
  useEffect(() => {
    if (!quickLookTab) {
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
      onQuickLookFollow(quickLookTab);
    }
    // The tab is rebuilt with the items on every re-read; its path is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickLookKey, quickLookOpen, onQuickLookFollow]);

  const rootTo = (folder: string, prefix = "") => {
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

  const homePath = places.data.favorites.find(
    (place) => place.name === "Home",
  )?.path;
  const rootHostPath = root === "~" ? homePath : root;
  const rootName =
    root === "~"
      ? "Home"
      : (root.split("/").findLast(Boolean) ??
        places.data.volumes[0]?.name ??
        "Root");
  const crumbs = breadcrumbs(
    currentListing?.path ?? rootHostPath ?? root,
    places.data,
  );

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border px-2 py-2 text-sm">
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
            isActive: rootHostPath === place.path,
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
            isActive: rootHostPath === volume.path,
            name: volume.name,
            path: volume.path,
          }))}
        />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1" ref={browserRef}>
          <FileSystem
            className="h-full rounded-none border-0"
            defaultPath={path}
            defaultView="columns"
            items={items}
            key={`${root}#${openings}`}
            loadChildren={async ({ path: prefix }) => {
              setLoaded((previous) =>
                previous.includes(prefix) ? previous : [...previous, prefix],
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
            onFileOpen={(file) => {
              void openFile(file);
            }}
            onPathChange={setCurrent}
            onSelectionChange={(item) => {
              setSelectedPath(item?.path ?? null);
            }}
            renderFileActions={(file) => {
              const tab = fileTabOf(file);
              return tab ? <FileOpenWith tab={tab} taskId={taskId} /> : null;
            }}
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
            title={rootName}
          />
        </div>
        <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-border px-2 text-xs text-muted-foreground">
          {crumbs.map((crumb, index) => (
            <span
              className="flex shrink-0 items-center gap-0.5"
              key={crumb.path}
            >
              {index > 0 ? <CaretRightIcon className="size-3" /> : null}
              <button
                className={cn(
                  "rounded px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground",
                  index === crumbs.length - 1 && "text-foreground",
                )}
                onClick={() => {
                  rootTo(crumb.path);
                }}
                type="button"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The folder's whole path on the Mac as the Finder writes it at the bottom
 * of a window: the volume, then every folder down to this one.
 */
function breadcrumbs(
  hostPath: string,
  places: { volumes: { name: string; path: string }[] },
) {
  const volume =
    places.volumes.find(
      (candidate) =>
        candidate.path !== "/" && hostPath.startsWith(`${candidate.path}/`),
    ) ?? places.volumes.find((candidate) => candidate.path === "/");
  const base = volume?.path ?? "/";
  const rest = hostPath.slice(base === "/" ? 1 : base.length + 1);
  const crumbs = [{ name: volume?.name ?? "Root", path: base }];
  let at = base === "/" ? "" : base;
  for (const segment of rest.split("/").filter(Boolean)) {
    at = `${at}/${segment}`;
    crumbs.push({ name: segment, path: at });
  }
  return crumbs;
}

/**
 * Stable while nothing changed: what each query holds, and only that, so a
 * re-render that fetched nothing new hands the browser the same items.
 */
function combineListings(results: { data: ComputerListing | undefined }[]) {
  return results.map((result) => result.data);
}

/**
 * The product's open control for a file the Finder view has selected: the
 * Mac's own app for it, with the other apps that take it a click away.
 */
function FileOpenWith({ tab, taskId }: { tab: FileTab; taskId: TaskId }) {
  const file = { filePath: tab.mount, taskId };
  const control = useTaskFileOpenControl(file);
  return (
    <OpenTaskFileButton
      className="text-muted-foreground"
      control={control}
      file={file}
      iconClassName="size-4"
      size="sm"
      variant="ghost"
    />
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
    name: file.path.split("/").at(-1) ?? file.path,
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
  label: string;
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
      <p className="px-2 pb-1 text-xs font-medium text-muted-foreground/70">
        {label}
      </p>
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
