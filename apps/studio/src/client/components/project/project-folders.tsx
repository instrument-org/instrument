import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { folderNameFromPath } from "@/client/lib/path-utils";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  DotsThreeOutlineVerticalIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
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
    if (result) {
      await addFolder({ id: projectId, path: result.path });
    }
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
              className="group flex items-center gap-x-2 rounded-md p-2 hover:bg-muted"
              key={path}
            >
              <MacFolderIcon className="size-6 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">
                  {folderNameFromPath(path)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {path}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground data-[state=open]:opacity-100">
                  <DotsThreeOutlineVerticalIcon
                    className="size-4"
                    weight="fill"
                  />
                  <span className="sr-only">Folder actions</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      void rpcClient.utils.showFileInFolder
                        .call({ filepath: path })
                        .catch(() => {
                          toast.error(
                            `Failed to ${getRevealInFolderLabel().toLowerCase()}`,
                          );
                        });
                    }}
                  >
                    <RevealInFolderIcon className="size-4" />
                    <span>{getRevealInFolderLabel()}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      removeFolder({ id: projectId, path });
                    }}
                    variant="destructive"
                  >
                    <TrashIcon className="size-4" />
                    <span>Remove from project</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
