import {
  DEFAULT_FOLDER_ACCESS,
  FolderAccessList,
} from "@/client/components/folder-access-list";
import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import {
  type ProjectFolder,
  type ProjectId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export function ProjectFolders({
  folders,
  projectId,
}: {
  folders: ProjectFolder[];
  projectId: ProjectId;
}) {
  const { mutate: addFolder } = useMutation(
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
  const { mutate: setFolderAccess } = useMutation(
    rpcClient.workspace.project.setFolderAccess.mutationOptions({
      onError: (error) => {
        toast.error("Failed to change folder access", {
          description: error.message,
        });
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
      if (folders.some((folder) => folder.path === result.path)) {
        toast.info("That folder is already attached to this project");
        return;
      }
      addFolder({
        access: DEFAULT_FOLDER_ACCESS,
        id: projectId,
        path: result.path,
      });
    }
  };

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg bg-card/60 pb-2 shadow-xs">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-medium">Attached folders</h2>
        <Button
          className="border-0 bg-transparent shadow-none"
          onClick={() => void handleAdd()}
          size="xs"
          variant="outline-muted"
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
        <FolderAccessList
          folders={folders}
          onAccessChange={(path, access) => {
            setFolderAccess({ access, id: projectId, path });
          }}
          onRemove={(path) => {
            removeFolder({ id: projectId, path });
          }}
        />
      )}
    </div>
  );
}
