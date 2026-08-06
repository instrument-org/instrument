import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { getFileType } from "@/client/lib/get-file-type";
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

import { useOpenTaskFile } from "../hooks/use-open-task-file";
import { useTaskFileOpenTarget } from "../hooks/use-task-file-open-target";
import { useTimedFlag } from "../hooks/use-timed-flag";
import { getRevealInFolderLabel } from "../lib/utils";
import { RevealInFolderIcon } from "./icons/reveal-in-folder";
import { OpenTargetIcon } from "./open-target-icon";
import { OpenWithMenu } from "./open-with-menu";
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
  const { showOpen } = useTaskFileOpenTarget(file);

  if (
    !onAddToChat &&
    !fileActions.showCopy &&
    !fileActions.showDownload &&
    !showOpen &&
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
  canCopy = true,
  file,
  menuComponents,
  onAddToChat,
}: {
  // Overrides showCopy to false when the preview couldn't actually be decoded
  // (e.g. a TIFF Chromium can't render) even though the file's mime type would
  // otherwise mark it copyable.
  canCopy?: boolean;
  file: TaskFileViewerFile;
  menuComponents: MenuComponents;
  onAddToChat?: () => void;
}) {
  const { Item, Separator } = menuComponents;
  const fileActions = useFileActionVisibility(file);
  const showCopy = fileActions.showCopy && canCopy;
  const openTaskFile = useOpenTaskFile();
  const { openLabel, showOpen, showOpenWith } = useTaskFileOpenTarget(file);

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
        // A hint only: the main process sniffs the bytes it just read and
        // treats this as the answer to "image or text" for a file that really
        // is binary.
        isImage: getFileType(file) === "image",
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
    showOpen || showCopy || fileActions.showDownload || fileActions.showReveal;

  if (!onAddToChat && !hasFileActions) {
    return null;
  }

  return (
    <>
      {showOpen && (
        <>
          <Item
            onClick={() => {
              openTaskFile(file);
            }}
          >
            <OpenTargetIcon className="size-4" file={file} />
            <span>{openLabel}</span>
          </Item>
          {showOpenWith && (
            <OpenWithMenu file={file} menuComponents={menuComponents} />
          )}
          {(onAddToChat != null || hasFileActions) && <Separator />}
        </>
      )}
      {onAddToChat && (
        <>
          <Item onClick={onAddToChat}>
            <ChatTextIcon className="size-4" />
            <span>Add to chat</span>
          </Item>
          {hasFileActions && <Separator />}
        </>
      )}
      {showCopy && (
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
          <span>Save as…</span>
        </Item>
      )}
      {(showCopy || fileActions.showDownload) && fileActions.showReveal && (
        <Separator />
      )}
      {fileActions.showReveal && (
        <Item onClick={handleRevealInFolder}>
          <RevealInFolderIcon className="size-4" />
          <span>{getRevealInFolderLabel()}</span>
        </Item>
      )}
    </>
  );
}
