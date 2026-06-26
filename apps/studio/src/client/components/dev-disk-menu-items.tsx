import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/client/components/ui/dropdown-menu";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectId, type TaskId } from "@instrument-org/workspace/client";
import { CopyIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

const devItemClass = "text-dev-700 dark:text-dev-300";
const devIconClass = "size-4 text-dev-700 dark:text-dev-300";

export function ProjectDevDiskMenuItems({
  projectId,
}: {
  projectId: ProjectId;
}) {
  const isDeveloperMode = useDeveloperMode();

  const revealMutation = useMutation(
    rpcClient.utils.showProjectInFolder.mutationOptions({
      onError: (error) => {
        toast.error("Failed to reveal project folder", {
          description: error.message,
        });
      },
    }),
  );

  const copyPathMutation = useMutation(
    rpcClient.utils.copyProjectPathToClipboard.mutationOptions({
      onError: (error) => {
        toast.error("Failed to copy project path", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast.success("Project path copied to clipboard");
      },
    }),
  );

  if (!isDeveloperMode) {
    return null;
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={devItemClass}
        onSelect={() => {
          void revealMutation.mutateAsync({ id: projectId });
        }}
      >
        <RevealInFolderIcon className={devIconClass} />
        <span>{getRevealInFolderLabel()}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        className={devItemClass}
        onSelect={() => {
          void copyPathMutation.mutateAsync({ id: projectId });
        }}
      >
        <CopyIcon className={devIconClass} />
        <span>Copy folder path</span>
      </DropdownMenuItem>
    </>
  );
}

export function TaskDevDiskMenuItems({ taskId }: { taskId: TaskId }) {
  const isDeveloperMode = useDeveloperMode();

  const revealMutation = useMutation(
    rpcClient.utils.openTaskIn.mutationOptions({
      onError: (error) => {
        toast.error("Failed to reveal task folder", {
          description: error.message,
        });
      },
    }),
  );

  const copyPathMutation = useMutation(
    rpcClient.utils.copyTaskPathToClipboard.mutationOptions({
      onError: (error) => {
        toast.error("Failed to copy folder path", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast.success("Folder path copied to clipboard");
      },
    }),
  );

  if (!isDeveloperMode) {
    return null;
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className={devItemClass}
        onSelect={() => {
          void revealMutation.mutateAsync({
            id: taskId,
            type: "show-in-folder",
          });
        }}
      >
        <RevealInFolderIcon className={devIconClass} />
        <span>{getRevealInFolderLabel()}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        className={devItemClass}
        onSelect={() => {
          void copyPathMutation.mutateAsync({ id: taskId });
        }}
      >
        <CopyIcon className={devIconClass} />
        <span>Copy folder path</span>
      </DropdownMenuItem>
    </>
  );
}
