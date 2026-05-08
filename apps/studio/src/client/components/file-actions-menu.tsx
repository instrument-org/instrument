import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
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
import { ContextMenuItem, ContextMenuSeparator } from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type MenuVariant = "context" | "dropdown";

export function FileActionsMenu({
  file,
  onAddToChat,
  variant = "ghost",
}: {
  file: ProjectFileViewerFile;
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
          onAddToChat={onAddToChat}
          variant="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FileActionsMenuItems({
  file,
  onAddToChat,
  variant,
}: {
  file: ProjectFileViewerFile;
  onAddToChat?: () => void;
  variant: MenuVariant;
}) {
  const fileActions = useFileActionVisibility(file);

  const showProjectFileInFolderMutation = useMutation(
    rpcClient.utils.showProjectFileInFolder.mutationOptions({
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
        isImage: file.mimeType.startsWith("image/"),
        subdomain: file.projectSubdomain,
        versionRef: file.versionRef,
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
    showProjectFileInFolderMutation.mutate({
      filePath: file.filePath,
      subdomain: file.projectSubdomain,
    });
  };

  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    variant === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  const hasFileActions =
    fileActions.showCopy || fileActions.showDownload || fileActions.showReveal;

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
