import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import {
  copyFileToClipboard,
  downloadFile,
  isFileCopyable,
  isFileDownloadable,
} from "@/client/lib/file-actions";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { type ProjectSubdomain } from "@instrument-org/workspace/client";
import {
  ArrowLineDownIcon,
  ChatTextIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeOutlineVerticalIcon,
} from "@phosphor-icons/react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
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

interface FileActionsMenuItemsProps {
  file: ProjectFileViewerFile;
  onAddToChat?: () => void;
  variant: MenuVariant;
}

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
}: FileActionsMenuItemsProps) {
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
        mimeType: file.mimeType,
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

function useFileActionVisibility(file: ProjectFileViewerFile) {
  const isLatestVersion = useIsLatestVersion({
    filePath: file.filePath,
    projectSubdomain: file.projectSubdomain,
    versionRef: file.versionRef,
  });

  const fileType = getFileType(file);
  const isDownloadable = isFileDownloadable(file.url);
  const isCopyableByMime = isFileCopyable(file.mimeType, file.url);
  const isTextLike =
    fileType === "code" ||
    fileType === "text" ||
    fileType === "markdown" ||
    fileType === "html";

  return {
    showCopy: isCopyableByMime || (isTextLike && isDownloadable),
    showDownload: isDownloadable,
    showReveal: isLatestVersion,
  };
}

function useIsLatestVersion({
  filePath,
  projectSubdomain,
  versionRef,
}: {
  filePath: string;
  projectSubdomain: ProjectSubdomain;
  versionRef?: string;
}) {
  const { data: versionRefs } = useQuery(
    rpcClient.workspace.project.git.fileVersionRefs.queryOptions({
      input: versionRef ? { filePath, projectSubdomain } : skipToken,
    }),
  );
  return (
    !versionRef ||
    !versionRefs ||
    versionRefs.length === 0 ||
    versionRefs.at(-1) === versionRef
  );
}
