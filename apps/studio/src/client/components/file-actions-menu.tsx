import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { rpcClient } from "@/client/rpc/client";
import {
  ArrowLineDownIcon,
  ChatTextIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
} from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTimedFlag } from "../hooks/use-timed-flag";
import { getRevealInFolderLabel } from "../lib/utils";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { Button, type ButtonVariant } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  dropdownMenuComponents,
  type MenuComponents,
} from "./ui/menu-components";

export function FileActionsMenu({
  file,
  onAddToChat,
  variant = "ghost",
}: {
  file: TaskFileViewerFile;
  onAddToChat?: () => void;
  variant?: ButtonVariant;
}) {
  const fileActions = useFileActionVisibility(file);

  if (
    !onAddToChat &&
    !fileActions.showCopy &&
    !fileActions.showDownload &&
    !fileActions.showReveal
  ) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant}>
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <FileActionsMenuItems
          file={file}
          menuComponents={dropdownMenuComponents}
          onAddToChat={onAddToChat}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FileActionsMenuItems({
  file,
  menuComponents,
  onAddToChat,
}: {
  file: TaskFileViewerFile;
  menuComponents: MenuComponents;
  onAddToChat?: () => void;
}) {
  const { Item, Separator } = menuComponents;
  const fileActions = useFileActionVisibility(file);

  const showTaskFileInFolderMutation = useMutation(
    rpcClient.utils.showTaskFileInFolder.mutationOptions({
      onError: (error) => {
        const label = getRevealInFolderLabel();
        const lowercasedLabel = label.charAt(0).toLowerCase() + label.slice(1);
        toast.error(`Failed to ${lowercasedLabel}`, {
          description: error.message,
        });
      },
    }),
  );

  const { active: copied, trigger: triggerCopied } = useTimedFlag();

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({
        filePath: file.filePath,
        id: file.taskId,
        isImage: file.mimeType.startsWith("image/"),
      });
      triggerCopied();
    } catch {
      // copyFileToClipboard already toasts on error
    }
  };

  const handleDownload = async () => {
    await downloadFile(file);
  };

  const handleRevealInFolder = () => {
    showTaskFileInFolderMutation.mutate({
      filePath: file.filePath,
      id: file.taskId,
    });
  };

  const hasFileActions =
    fileActions.showCopy || fileActions.showDownload || fileActions.showReveal;

  if (!onAddToChat && !hasFileActions) {
    return null;
  }

  return (
    <>
      {onAddToChat && (
        <>
          <Item onClick={onAddToChat}>
            <ChatTextIcon className="size-4" />
            <span>Add to chat</span>
          </Item>
          {hasFileActions && <Separator />}
        </>
      )}
      {fileActions.showCopy && (
        <Item onClick={() => void handleCopy()}>
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          <span>Copy</span>
        </Item>
      )}
      {fileActions.showDownload && (
        <Item onClick={() => void handleDownload()}>
          <ArrowLineDownIcon className="size-4" />
          <span>Download</span>
        </Item>
      )}
      {(fileActions.showCopy || fileActions.showDownload) &&
        fileActions.showReveal && <Separator />}
      {fileActions.showReveal && (
        <Item onClick={handleRevealInFolder}>
          <RevealInFolderIcon className="size-4" />
          <span>{getRevealInFolderLabel()}</span>
        </Item>
      )}
    </>
  );
}
