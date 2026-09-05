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
import { rpcClient } from "@/client/rpc/client";
import { type ComputerListing } from "@instrument-org/workspace/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { LaptopIcon } from "@phosphor-icons/react/Laptop";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";

/** How often every folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("4 seconds");

/**
 * This Mac, browsed the way the Finder browses it. The top level is the
 * places a person keeps things and every volume; under each is the real
 * folder, read as the app's own user, so every folder opens. Whether
 * Instrument may read one is a separate question, answered in the pane past
 * the last column and settled there with one click.
 *
 * The file browser holds a flat manifest and asks for a folder's children the
 * first time it is opened. Every folder it has asked for is re-read on a
 * clock, so what a task writes shows up without a refresh.
 */
export function ComputerPage({ path }: { path: string }) {
  const { taskId } = useOrchestrator();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setComputerView = useSetAtom(computerViewAtom);
  const places = useQuery(rpcClient.workspace.computer.places.queryOptions());
  // Folder prefixes under This Mac that the browser has opened.
  const [loaded, setLoaded] = useState<readonly string[]>([]);
  const [current, setCurrent] = useState(path);
  // The path rather than the item: the items are rebuilt on every re-read,
  // and a selection held as one of them would change with each.
  const [selectedPath, setSelectedPath] = useState<null | string>(null);

  const roots = new Map<string, string>(
    [...(places.data?.favorites ?? []), ...(places.data?.volumes ?? [])].map(
      (place) => [place.name, place.path],
    ),
  );
  const hostPathOf = (prefix: string): string | undefined => {
    const [head, ...rest] = prefix.replace(/\/$/, "").split("/");
    const root = head === undefined ? undefined : roots.get(head);
    return root === undefined
      ? undefined
      : rest.length > 0
        ? `${root}/${rest.join("/")}`
        : root;
  };

  const listings = useQueries({
    combine: combineListings,
    queries: loaded.map((prefix) =>
      rpcClient.workspace.computer.list.queryOptions({
        input: { id: taskId, path: hostPathOf(prefix) ?? "" },
        refetchInterval: REFRESH_MS,
      }),
    ),
  });
  const assetBase = getAssetBaseUrl(taskId);
  const placeItems: FileSystemItem[] = [...roots.keys()].map((name) => ({
    hasChildren: true,
    kind: "folder",
    path: `${name}/`,
  }));
  const items = [
    ...placeItems,
    ...listings.flatMap((data, index) => {
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
    }),
  ];

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
        search: { path: onScreen },
        to: "/orchestrator/computer",
      });
    }
  }, [navigate, onScreen, path]);

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

  if (!places.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 pt-10">
      <FileSystem
        className="h-full"
        defaultPath={path}
        defaultView="columns"
        items={items}
        loadChildren={async ({ path: prefix }) => {
          if (hostPathOf(prefix) === undefined) {
            return { items: [] };
          }
          setLoaded((previous) =>
            previous.includes(prefix) ? previous : [...previous, prefix],
          );
          await queryClient.fetchQuery(
            rpcClient.workspace.computer.list.queryOptions({
              input: { id: taskId, path: hostPathOf(prefix) ?? "" },
            }),
          );
          // The entries arrive through `items`, re-read on the clock above,
          // so the browser is handed none of its own to hold.
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
              allow.mutate({ access: "read-write", id: taskId, path: folder });
            }}
            prefix={prefix}
          />
        )}
        title="This Mac"
      />
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
  prefix,
}: {
  isAllowing: boolean;
  listing: ComputerListing | undefined;
  onAllow: (hostPath: string) => void;
  prefix: string;
}) {
  if (prefix === "") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <LaptopIcon className="size-8" />
        <p>This Mac. Open a folder to see whether Instrument can work in it.</p>
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const name = prefix.replace(/\/$/, "").split("/").at(-1) ?? prefix;
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
 * Stable while nothing changed: what each query holds, and only that, so a
 * re-render that fetched nothing new hands the browser the same items.
 */
function combineListings(results: { data: ComputerListing | undefined }[]) {
  return results.map((result) => result.data);
}
