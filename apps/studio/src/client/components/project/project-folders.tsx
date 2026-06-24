import { Button } from "@/client/components/ui/button";
import { folderNameFromPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { FolderIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

// The project's attached folders (right column, beneath Instructions). Folders
// here are auto-attached to every task created in the project.
export function ProjectFolders({
  folders,
  projectId,
}: {
  folders: string[];
  projectId: ProjectId;
}) {
  const { mutateAsync: addFolder } = useMutation(
    rpcClient.workspace.project.addFolder.mutationOptions({
      onError: (error) => {
        toast.error("Failed to attach folder", { description: error.message });
      },
    }),
  );
  const { mutate: removeFolder } = useMutation(
    rpcClient.workspace.project.removeFolder.mutationOptions({
      onError: (error) => {
        toast.error("Failed to remove folder", { description: error.message });
      },
    }),
  );

  const handleAdd = async () => {
    const [error, result] = await safe(
      rpcClient.utils.showFolderPicker.call({}),
    );
    if (error) {
      toast.error("Failed to open folder picker");
      return;
    }
    if (!result) {
      return;
    }
    await addFolder({ id: projectId, path: result.path });
  };

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Attached folders</h2>
        <Button
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => void handleAdd()}
          size="sm"
          variant="ghost"
        >
          <PlusIcon className="size-3.5" />
          Add a folder
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Attached to every task created in this project.
      </p>
      {folders.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground/70">
          No folders attached yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-y-1">
          {folders.map((path) => (
            <li
              className="group flex items-center gap-x-2 rounded-md border p-2"
              key={path}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {folderNameFromPath(path)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {path}
                </span>
              </div>
              <button
                aria-label="Remove folder"
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                onClick={() => {
                  removeFolder({ id: projectId, path });
                }}
                type="button"
              >
                <XIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
