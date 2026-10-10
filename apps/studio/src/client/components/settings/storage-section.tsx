import { ShowInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { settingAnchor } from "@/client/components/settings/settings-index";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { showInFolder, showInFolderLabel } from "@/client/lib/show-in-files";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/client/lib/toast";

type InvalidFolder =
  RPCOutput["workspace"]["storage"]["invalidFolders"]["list"][number];

export function StorageSection() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Storage</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Where {APP_NAME} keeps your chats and tasks on your computer
        </p>
      </div>
      <WorkspaceLocation />
      <UnrecognizedFolders />
    </div>
  );
}

function FolderGroup({
  folders,
  onReveal,
  onTrash,
  title,
}: {
  folders: InvalidFolder[];
  onReveal: (folder: InvalidFolder) => void;
  onTrash: (folder: InvalidFolder) => void;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="divide-y overflow-hidden rounded-lg border">
        {folders.map((folder) => (
          <div className="flex items-center gap-3 p-3" key={folder.path}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-sm">{folder.name}</div>
              <p className="text-xs text-muted-foreground">{folder.reason}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <DotsThreeOutlineVerticalIcon
                    className="size-4"
                    weight="fill"
                  />
                  <span className="sr-only">{`Actions for ${folder.name}`}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    onReveal(folder);
                  }}
                >
                  <ShowInFolderIcon
                    className="size-4 text-muted-foreground"
                    kind="folder"
                  />
                  <span>{showInFolderLabel("folder")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    onTrash(folder);
                  }}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  <span>Move to trash</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </div>
  );
}

function UnrecognizedFolders() {
  const queryClient = useQueryClient();
  const { data: folders } = useQuery(
    rpcClient.workspace.storage.invalidFolders.list.queryOptions(),
  );
  const trashMutation = useMutation(
    rpcClient.workspace.storage.invalidFolders.trash.mutationOptions(),
  );
  const [folderToTrash, setFolderToTrash] = useState<InvalidFolder | null>(
    null,
  );

  const confirmTrash = async () => {
    if (!folderToTrash) {
      return;
    }
    const folder = folderToTrash;
    setFolderToTrash(null);
    try {
      await trashMutation.mutateAsync({ kind: folder.kind, name: folder.name });
      await queryClient.invalidateQueries({
        queryKey: rpcClient.workspace.storage.invalidFolders.list.key(),
      });
      toast.success(`Moved “${folder.name}” to the trash`);
    } catch (error) {
      toast.error(`Couldn't move “${folder.name}” to the trash`, {
        cause: error,
      });
    }
  };

  if (!folders || folders.length === 0) {
    return null;
  }

  const chats = folders.filter((folder) => folder.kind === "chat");
  // A task inside a chat is a task to the person, wherever its folder is.
  const tasks = folders.filter((folder) => folder.kind !== "chat");

  return (
    <section className="space-y-4" {...settingAnchor("broken-folders")}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <FolderIcon className="size-4" />
          <h4 className="text-sm font-medium">Broken chats and tasks</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          These chats and tasks are included in your workspace, but {APP_NAME}{" "}
          can&apos;t show them because of problems in the folders. You can
          reveal them on your computer, or delete them to tidy up.
        </p>
      </div>
      {chats.length > 0 && (
        <FolderGroup
          folders={chats}
          onReveal={(folder) => {
            void showInFolder(folder.path, { kind: "folder" });
          }}
          onTrash={setFolderToTrash}
          title="Chats"
        />
      )}
      {tasks.length > 0 && (
        <FolderGroup
          folders={tasks}
          onReveal={(folder) => {
            void showInFolder(folder.path, { kind: "folder" });
          }}
          onTrash={setFolderToTrash}
          title="Tasks"
        />
      )}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setFolderToTrash(null);
          }
        }}
        open={folderToTrash !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {folderToTrash
                ? `Move “${folderToTrash.name}” to the trash?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Moves the folder to your system trash. You can still recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmTrash();
              }}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function WorkspaceLocation() {
  const { data: location } = useQuery(
    rpcClient.workspace.storage.location.queryOptions(),
  );

  if (!location) {
    return null;
  }

  return (
    <section className="space-y-2" {...settingAnchor("workspace-location")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Workspace location
        </h4>
        <Button
          onClick={() => {
            void showInFolder(location.rootDir, { kind: "folder" });
          }}
          size="sm"
          variant="outline"
        >
          <ShowInFolderIcon className="size-4" kind="folder" />
          {showInFolderLabel("folder")}
        </Button>
      </div>
      <div className="rounded-lg border bg-muted/40 px-3 py-2 select-text">
        <code className="font-mono text-xs break-all text-foreground">
          {location.rootDir}
        </code>
      </div>
    </section>
  );
}
