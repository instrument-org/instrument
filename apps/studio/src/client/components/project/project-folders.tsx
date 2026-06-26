import { FolderAttachmentRow } from "@/client/components/folder-attachment-row";
import { Button } from "@/client/components/ui/button";
import { folderNameFromPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { PlusIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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
      if (folders.includes(result.path)) {
        toast.info("That folder is already attached to this project");
        return;
      }
      await addFolder({ id: projectId, path: result.path });
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-card/60 pb-1">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-medium">Attached folders</h2>
        <Button
          className="text-muted-foreground"
          onClick={() => void handleAdd()}
          size="xs"
          variant="ghost"
        >
          <PlusIcon className="size-3" />
          Add a folder
        </Button>
      </div>
      {folders.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground/70">
          No folders attached yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {folders.map((path) => (
            <li key={path}>
              <FolderAttachmentRow
                name={folderNameFromPath(path)}
                onRemove={() => {
                  removeFolder({ id: projectId, path });
                }}
                path={path}
                removeLabel="Remove from project"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
