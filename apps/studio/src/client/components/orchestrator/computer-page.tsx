import { type FileTab } from "@/client/atoms/orchestrator";
import {
  FileSystem,
  type FileSystemFileItem,
  FileSystemFolderGlyph,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ComputerListing } from "@instrument-org/workspace/client";
import { formatBytes } from "@instrument-org/workspace/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/LockSimpleOpen";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import ms from "ms";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";

/** How often every folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("4 seconds");

/** The folder the user is looking at, for the conversation. */
export interface FolderOnScreen {
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
 * in, opened as the app's own user so every folder opens. Whether Instrument
 * may read one is said in the pane past the last column, as a line rather
 * than a control: what it can reach is what the user has granted, and asking
 * for more is the conversation's to do. Under the columns, the folder's whole
 * path on the Mac, each part a way back up.
 *
 * The file browser holds a flat manifest and asks for a folder's children the
 * first time it is opened. Every folder it has asked for is re-read on a
 * clock, so what a task writes shows up without a refresh.
 */
export function ComputerPage({
  onFolderChange,
  onOpenFile,
  onQuickLook,
  path,
  root,
}: {
  /** Told the folder on screen whenever it changes. */
  onFolderChange: (folder: FolderOnScreen) => void;
  /** A file the user opened, when a granted folder covers it. */
  onOpenFile: (file: FileTab) => void;
  /** The selected file, on Space. */
  onQuickLook: (file: FileTab) => void;
  path: string;
  root: string;
}) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  const instrumentFolder = places.data?.favorites.find(
    (place) => place.name === "Instrument",
  )?.path;
  // `~` and `instrument` are names for folders; anything else is one.
  const rootPath =
    root === "instrument" ? (instrumentFolder ?? undefined) : root;
  // Folder prefixes under the root that the browser has opened, root first.
  const [loaded, setLoaded] = useState<readonly string[]>([""]);
  const [current, setCurrent] = useState(path);
  // The path rather than the item: the items are rebuilt on every re-read,
  // and a selection held as one of them would change with each.
  const [selectedPath, setSelectedPath] = useState<null | string>(null);

  const hostPathOf = (prefix: string) => {
    if (rootPath === undefined) {
      return;
    }
    const folder = prefix.replace(/\/$/, "");
    return folder ? `${rootPath}/${folder}` : rootPath;
  };

  const listings = useQueries({
    combine: combineListings,
    queries: loaded.map((prefix) =>
      rpcClient.workspace.computer.list.queryOptions({
        enabled: rootPath !== undefined,
        input: { id: taskId, path: hostPathOf(prefix) ?? "" },
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
      void navigate({
        replace: true,
        search: (previous) => ({ ...previous, path: onScreen, root }),
        to: "/orchestrator/computer",
      });
    }
  }, [navigate, onScreen, path, root]);

  // What the conversation is told "this folder" means.
  const display = currentListing?.display;
  const hostPath = currentListing?.path;
  const mount = currentListing?.access?.mountPath;
  const selectedName =
    selectedPath !== null && !selectedPath.endsWith("/")
      ? selectedPath.split("/").at(-1)
      : undefined;
  useEffect(() => {
    if (display === undefined || hostPath === undefined) {
      return;
    }
    onFolderChange({
      display,
      hostPath,
      ...(mount === undefined ? {} : { mount }),
      selected: selectedName ? [selectedName] : [],
    });
  }, [display, hostPath, mount, onFolderChange, selectedName]);

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

  const rootTo = (folder: string, prefix = "") => {
    void navigate({
      search: { path: prefix, root: folder },
      to: "/orchestrator/computer",
    });
  };

  if (!places.data || rootPath === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  const rootName =
    root === "~"
      ? "Home"
      : root === "instrument"
        ? "Instrument"
        : (rootPath.split("/").findLast(Boolean) ?? "Macintosh HD");
  const crumbs = breadcrumbs(currentListing?.path ?? rootPath, places.data);

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-44 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border px-2 py-2 text-sm">
        <PlaceList
          label="Favorites"
          onOpen={(folder) => {
            rootTo(folder === places.data.favorites[0]?.path ? "~" : folder);
          }}
          places={places.data.favorites.map((place) => ({
            icon:
              place.name === "Instrument" ? (
                // Everything made here, under the mark of what made it.
                <InstrumentGlyph className="size-4 text-muted-foreground" />
              ) : (
                <FileSystemFolderGlyph className="h-3.5 w-auto" />
              ),
            isActive: rootPath === place.path,
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
            isActive: rootPath === volume.path,
            name: volume.name,
            path: volume.path,
          }))}
        />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <FileSystem
            className="h-full rounded-none border-0"
            defaultPath={path}
            defaultView="columns"
            items={items}
            key={rootPath}
            loadChildren={async ({ path: prefix }) => {
              setLoaded((previous) =>
                previous.includes(prefix) ? previous : [...previous, prefix],
              );
              await queryClient.fetchQuery(
                rpcClient.workspace.computer.list.queryOptions({
                  input: { id: taskId, path: hostPathOf(prefix) ?? "" },
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
            renderTrailing={(prefix) => (
              <FolderPane listing={listingOf(prefix)} />
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
  const crumbs = [{ name: volume?.name ?? "Macintosh HD", path: base }];
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

/**
 * The pane past the last column while no file is selected: the folder the
 * user opened, the way the Finder's preview column shows one, with whether
 * Instrument can see it as one line.
 */
function FolderPane({ listing }: { listing: ComputerListing | undefined }) {
  if (!listing) {
    return null;
  }
  const name =
    listing.display === "~"
      ? "Home"
      : (listing.path.split("/").findLast(Boolean) ?? "Macintosh HD");
  const folders = listing.entries.filter((entry) => entry.kind === "folder");
  const files = listing.entries.filter((entry) => entry.kind === "file");
  const bytes = files.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const count = [
    folders.length > 0
      ? `${folders.length} folder${folders.length === 1 ? "" : "s"}`
      : "",
    files.length > 0
      ? `${files.length} file${files.length === 1 ? "" : "s"}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      {listing.display === "~/Documents/Instrument" ? (
        <InstrumentGlyph className="size-14 text-muted-foreground" />
      ) : (
        <FileSystemFolderGlyph className="h-12 w-auto drop-shadow-sm" />
      )}
      <p className="mt-2 text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">
        {count || "Empty"}
        {bytes > 0 ? ` · ${formatBytes(bytes)}` : ""}
        {listing.truncated ? " · first 2000 shown" : ""}
      </p>
      <p className="max-w-full truncate text-xs text-muted-foreground/70">
        {listing.display}
      </p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        {listing.access ? (
          <>
            <LockSimpleOpenIcon className="size-3.5" />
            Instrument can{" "}
            {listing.access.access === "read-write"
              ? "read and write"
              : "read"}{" "}
            here
          </>
        ) : (
          <>
            <LockSimpleIcon className="size-3.5" />
            Instrument cannot see in here yet
          </>
        )}
      </p>
      <Button
        className="mt-1 text-muted-foreground"
        onClick={() => {
          void rpcClient.utils.showFileInFolder.call({
            filepath: listing.path,
          });
        }}
        size="xs"
        variant="ghost"
      >
        <ArrowSquareOutIcon className="size-3.5" />
        Show in Finder
      </Button>
    </div>
  );
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
