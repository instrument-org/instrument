import { computerViewAtom } from "@/client/atoms/orchestrator";
import {
  FileSystem,
  type FileSystemFileItem,
  type FileSystemItem,
} from "@/client/components/extend/file-system";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { getAssetBaseUrl } from "@/client/lib/asset-base-url";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ComputerListing } from "@instrument-org/workspace/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { DesktopIcon } from "@phosphor-icons/react/Desktop";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { HardDriveIcon } from "@phosphor-icons/react/HardDrive";
import { HouseIcon } from "@phosphor-icons/react/House";
import { LockSimpleIcon } from "@phosphor-icons/react/LockSimple";
import { LockSimpleOpenIcon } from "@phosphor-icons/react/LockSimpleOpen";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import ms from "ms";
import { type ComponentType, useEffect, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";

/** How often every folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("4 seconds");

const FAVORITE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Desktop: DesktopIcon,
  Downloads: DownloadSimpleIcon,
  Home: HouseIcon,
};

/**
 * This Mac, browsed the way the Finder browses it: a sidebar of the places a
 * person keeps things and every volume, and the folder the browser is rooted
 * in, opened as the app's own user so every folder opens. Whether Instrument
 * may read one is a separate question, answered in the pane past the last
 * column and settled there with one click. Under the columns, the folder's
 * whole path on the Mac, each part a way back up.
 *
 * The file browser holds a flat manifest and asks for a folder's children the
 * first time it is opened. Every folder it has asked for is re-read on a
 * clock, so what a task writes shows up without a refresh.
 */
export function ComputerPage({ path, root }: { path: string; root: string }) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setComputerView = useSetAtom(computerViewAtom);
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
        search: { path: onScreen, root },
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
    setComputerView({
      folder: display,
      hostPath,
      ...(mount === undefined ? {} : { mount }),
      selected: selectedName ? [selectedName] : [],
    });
  }, [display, hostPath, mount, selectedName, setComputerView]);

  const allow = useMutation(
    rpcClient.workspace.task.state.attachFolder.mutationOptions({
      onError: (error) => {
        toast.error("Could not allow the folder", {
          description: error.message,
        });
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.computer.list
            .queryOptions({ input: { id: taskId, path: "" } })
            .queryKey.slice(0, -1),
        });
      },
    }),
  );

  const openFile = async (file: FileSystemFileItem) => {
    const mounted = file.metadata?.mount;
    if (mounted) {
      await navigate({ search: { path: mounted }, to: "/orchestrator/file" });
      return;
    }
    const filepath = file.metadata?.hostPath;
    if (!filepath) {
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
            icon: FAVORITE_ICONS[place.name] ?? FolderIcon,
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
            icon: HardDriveIcon,
            isActive: rootPath === volume.path,
            name: volume.name,
            path: volume.path,
          }))}
        />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <FileSystem
            className="h-full"
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
              <AccessPane
                isAllowing={allow.isPending}
                listing={listingOf(prefix)}
                onAllow={(folder) => {
                  allow.mutate({
                    access: "read-write",
                    id: taskId,
                    path: folder,
                  });
                }}
              />
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
 * The pane past the last column while no file is selected: the folder on
 * screen and whether Instrument can see it, with the one thing to do about
 * it when it cannot.
 */
function AccessPane({
  isAllowing,
  listing,
  onAllow,
}: {
  isAllowing: boolean;
  listing: ComputerListing | undefined;
  onAllow: (hostPath: string) => void;
}) {
  if (!listing) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const name =
    listing.display === "~"
      ? "Home"
      : (listing.path.split("/").findLast(Boolean) ?? "Macintosh HD");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {listing.access ? (
        <>
          <LockSimpleOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            Instrument can{" "}
            {listing.access.access === "read-write" ? "read and write" : "read"}{" "}
            here.
          </p>
        </>
      ) : (
        <>
          <LockSimpleIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            Instrument can’t see this folder yet.
          </p>
          <Button
            disabled={isAllowing}
            onClick={() => {
              onAllow(listing.path);
            }}
            size="sm"
          >
            Allow Instrument here
          </Button>
        </>
      )}
      <p className="max-w-full truncate text-xs text-muted-foreground/70">
        {listing.display}
      </p>
      <Button
        onClick={() => {
          void rpcClient.utils.showFileInFolder.call({
            filepath: listing.path,
          });
        }}
        size="sm"
        variant="ghost"
      >
        <ArrowSquareOutIcon className="size-4" />
        Show in Finder
      </Button>
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

function PlaceList({
  label,
  onOpen,
  places,
}: {
  label: string;
  onOpen: (path: string) => void;
  places: {
    icon: ComponentType<{ className?: string }>;
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
              <place.icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{place.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
