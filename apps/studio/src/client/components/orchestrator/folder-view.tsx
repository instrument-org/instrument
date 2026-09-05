import { FileIcon } from "@/client/components/file-icon";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  formatBytes,
  MOUNT,
  type TaskId,
  WorkspaceFilePathSchema,
} from "@instrument-org/workspace/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { FolderPlusIcon } from "@phosphor-icons/react/FolderPlus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ms from "ms";
import { toast } from "sonner";

/** How often a folder on screen is re-read, so files a task writes appear. */
const REFRESH_MS = ms("3 seconds");

/**
 * The human's side of the window: the folders the conversation can reach,
 * drawn the way a file browser draws them, over the same layout the agent's
 * tools resolve against. What is open here, and what is selected, is what
 * "this folder" and "these" mean when the user asks for something.
 */
export function FolderView({
  folder,
  onNavigate,
  onSelect,
  selected,
  taskId,
}: {
  /** The virtual path on screen; `/` lists the folders themselves. */
  folder: string;
  onNavigate: (path: string) => void;
  onSelect: (paths: string[]) => void;
  selected: ReadonlySet<string>;
  taskId: TaskId;
}) {
  const queryClient = useQueryClient();
  const listing = useQuery(
    rpcClient.workspace.orchestrator.listFolder.queryOptions({
      input: { id: taskId, path: folder },
      refetchInterval: REFRESH_MS,
    }),
  );
  const attach = useMutation(
    rpcClient.workspace.task.state.attachFolder.mutationOptions({
      onError: (error) => {
        toast.error("Could not add the folder", {
          description: error.message,
        });
      },
      onSuccess: (attached) => {
        void queryClient.invalidateQueries({
          queryKey: rpcClient.workspace.orchestrator.listFolder.queryOptions({
            input: { id: taskId, path: "/" },
          }).queryKey,
        });
        onNavigate(`${MOUNT.attachedFolders}/${attached.mountName}`);
      },
    }),
  );

  const addFolder = async () => {
    const picked = await rpcClient.utils.showFolderPicker.call();
    if (picked) {
      attach.mutate({ access: "read-write", id: taskId, path: picked.path });
    }
  };

  const openFile = async (path: string) => {
    const filePath = WorkspaceFilePathSchema.safeParse(path);
    if (!filePath.success) {
      return;
    }
    try {
      await rpcClient.utils.openTaskFile.call({
        filePath: filePath.data,
        id: taskId,
      });
    } catch (error) {
      toast.error("Could not open the file", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const reveal = async () => {
    const filePath = WorkspaceFilePathSchema.safeParse(folder);
    if (!filePath.success) {
      return;
    }
    await rpcClient.utils.showTaskFileInFolder.call({
      filePath: filePath.data,
      id: taskId,
    });
  };

  const crumbs = breadcrumbs(folder);
  const entries = listing.data?.entries ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-sm">
        {crumbs.map((crumb, index) => (
          <span className="flex items-center gap-1" key={crumb.path}>
            {index > 0 ? (
              <CaretRightIcon className="size-3 text-muted-foreground" />
            ) : null}
            <button
              className={cn(
                "rounded-md px-1.5 py-0.5 hover:bg-foreground/5",
                index === crumbs.length - 1
                  ? "font-medium"
                  : "text-muted-foreground",
              )}
              onClick={() => {
                onNavigate(crumb.path);
              }}
              type="button"
            >
              {crumb.label}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        {folder !== "/" ? (
          <Button
            onClick={() => {
              void reveal();
            }}
            size="sm"
            variant="ghost"
          >
            <ArrowSquareOutIcon className="size-4" />
            Show in Finder
          </Button>
        ) : null}
        <Button
          disabled={attach.isPending}
          onClick={() => {
            void addFolder();
          }}
          size="sm"
          variant="secondary"
        >
          <FolderPlusIcon className="size-4" />
          Add folder…
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {listing.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : listing.error ? (
          <p className="p-4 text-sm text-destructive">
            {listing.error.message}
          </p>
        ) : entries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {folder === "/"
              ? "No folders yet. Add one, and anything you ask for can land in it."
              : "Empty folder."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-1.5 text-left font-medium">Name</th>
                <th className="w-40 px-3 py-1.5 text-left font-medium">
                  Kind
                </th>
                <th className="w-24 px-3 py-1.5 text-right font-medium">
                  Size
                </th>
                <th className="w-40 px-3 py-1.5 text-left font-medium">
                  Modified
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isSelected = selected.has(entry.path);
                return (
                  <tr
                    className={cn(
                      "cursor-default select-none border-b border-border/50",
                      isSelected ? "bg-foreground/10" : "hover:bg-foreground/5",
                    )}
                    key={entry.path}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey) {
                        const next = new Set(selected);
                        if (next.has(entry.path)) {
                          next.delete(entry.path);
                        } else {
                          next.add(entry.path);
                        }
                        onSelect([...next]);
                      } else {
                        onSelect([entry.path]);
                      }
                    }}
                    onDoubleClick={() => {
                      if (entry.kind === "folder") {
                        onNavigate(entry.path);
                      } else {
                        void openFile(entry.path);
                      }
                    }}
                  >
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        {entry.kind === "folder" ? (
                          <FolderIcon
                            className="size-5 shrink-0 text-muted-foreground"
                            weight="fill"
                          />
                        ) : (
                          <FileIcon
                            className="size-5 shrink-0"
                            filename={entry.name}
                            mimeType={entry.mimeType}
                          />
                        )}
                        <span className="truncate">{entry.name}</span>
                        {entry.access === "read-only" ? (
                          <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                            read-only
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="truncate px-3 py-1.5 text-muted-foreground">
                      {entry.kind === "folder"
                        ? "Folder"
                        : (entry.mimeType ?? "File")}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
                      {entry.size === undefined ? "" : formatBytes(entry.size)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                      {entry.modifiedAt === undefined
                        ? ""
                        : new Date(entry.modifiedAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {listing.data?.truncated ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Showing the first entries of a large folder.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The path as a person reads it: the folder's own name rather than its mount
 * prefix, and every folder above it back to the list of folders.
 */
function breadcrumbs(folder: string): { label: string; path: string }[] {
  const crumbs = [{ label: "Folders", path: "/" }];
  const prefix = `${MOUNT.attachedFolders}/`;
  if (!folder.startsWith(prefix)) {
    return crumbs;
  }
  const segments = folder.slice(prefix.length).split("/").filter(Boolean);
  let path: string = MOUNT.attachedFolders;
  for (const segment of segments) {
    path = `${path}/${segment}`;
    crumbs.push({ label: segment, path });
  }
  return crumbs;
}
