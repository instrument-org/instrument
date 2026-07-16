import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { type MenuComponents } from "@/client/components/ui/menu-components";
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
  menuComponents,
  projectId,
}: {
  menuComponents: MenuComponents;
  projectId: ProjectId;
}) {
  const { Item, Separator } = menuComponents;
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
      <Separator />
      <Item
        className={devItemClass}
        onSelect={() => {
          revealMutation.mutate({ id: projectId });
        }}
      >
        <RevealInFolderIcon className={devIconClass} />
        <span>{getRevealInFolderLabel()}</span>
      </Item>
      <Item
        className={devItemClass}
        onSelect={() => {
          copyPathMutation.mutate({ id: projectId });
        }}
      >
        <CopyIcon className={devIconClass} />
        <span>Copy folder path</span>
      </Item>
    </>
  );
}

export function TaskDevDiskMenuItems({
  menuComponents,
  taskId,
}: {
  menuComponents: MenuComponents;
  taskId: TaskId;
}) {
  const { Item, Separator } = menuComponents;
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
      <Separator />
      <Item
        className={devItemClass}
        onSelect={() => {
          revealMutation.mutate({
            id: taskId,
            type: "show-in-folder",
          });
        }}
      >
        <RevealInFolderIcon className={devIconClass} />
        <span>{getRevealInFolderLabel()}</span>
      </Item>
      <Item
        className={devItemClass}
        onSelect={() => {
          copyPathMutation.mutate({ id: taskId });
        }}
      >
        <CopyIcon className={devIconClass} />
        <span>Copy folder path</span>
      </Item>
    </>
  );
}
