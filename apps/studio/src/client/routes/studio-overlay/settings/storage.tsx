import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
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
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import {
  DotsThreeOutlineVerticalIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

type InvalidFolder =
  RPCOutput["workspace"]["storage"]["invalidFolders"]["list"][number];

export const Route = createFileRoute("/studio-overlay/settings/storage")({
  component: SettingsStoragePage,
});

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
              <div className="truncate font-mono text-sm">{folder.name}</div>
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
                  <RevealInFolderIcon className="size-4 text-muted-foreground" />
                  <span>{getRevealInFolderLabel()}</span>
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

function SettingsStoragePage() {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold">Storage</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Where {APP_NAME} keeps your tasks and projects on disk.
        </p>
      </div>
      <WorkspaceLocation />
      <UnrecognizedFolders />
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
  const revealMutation = useMutation(
    rpcClient.utils.showFileInFolder.mutationOptions({
      onError: () => {
        toast.error("Couldn't reveal that folder", {
          position: "bottom-center",
        });
      },
    }),
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
      toast.success(`Moved "${folder.name}" to the trash`, {
        position: "bottom-center",
      });
    } catch {
      toast.error(`Couldn't move "${folder.name}" to the trash`, {
        position: "bottom-center",
      });
    }
  };

  if (!folders || folders.length === 0) {
    return null;
  }

  const projects = folders.filter((folder) => folder.kind === "project");
  const tasks = folders.filter((folder) => folder.kind === "task");

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <WarningIcon className="text-amber-500 size-4" weight="fill" />
          <h4 className="text-sm font-medium">Unrecognized folders</h4>
        </div>
        <p className="text-sm text-muted-foreground">
          {APP_NAME} can&apos;t open these as a task or project. Take a look at
          one to see what&apos;s inside, or move it to the trash.
        </p>
      </div>
      {projects.length > 0 && (
        <FolderGroup
          folders={projects}
          onReveal={(folder) => {
            revealMutation.mutate({ filepath: folder.path });
          }}
          onTrash={setFolderToTrash}
          title="Projects"
        />
      )}
      {tasks.length > 0 && (
        <FolderGroup
          folders={tasks}
          onReveal={(folder) => {
            revealMutation.mutate({ filepath: folder.path });
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
                ? `Move "${folderToTrash.name}" to the trash?`
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
  const revealMutation = useMutation(
    rpcClient.utils.openFolder.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't open the workspace folder", {
          description: error.message,
          position: "bottom-center",
        });
      },
    }),
  );

  if (!location) {
    return null;
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Workspace location
        </h4>
        <Button
          onClick={() => {
            revealMutation.mutate({ folderPath: location.rootDir });
          }}
          size="sm"
          variant="outline"
        >
          <RevealInFolderIcon className="size-4" />
          {getRevealInFolderLabel()}
        </Button>
      </div>
      <div className="rounded-lg border bg-muted/40 px-3 py-2">
        <code className="font-mono text-xs break-all text-foreground">
          {location.rootDir}
        </code>
      </div>
    </section>
  );
}
