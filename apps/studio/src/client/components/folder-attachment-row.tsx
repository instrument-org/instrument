import {
  FolderAccessControl,
  FolderAccessLabel,
} from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { rpcClient } from "@/client/rpc/client";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { XIcon } from "@phosphor-icons/react/X";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { SidebarMenuButton } from "./ui/sidebar";

/**
 * An attached folder, listed where the task's files are.
 *
 * Laid out like the project's list, because it is the same folder with the same
 * two decisions attached to it: what the agent may do with it, and the way out
 * beside it. The middle opens it.
 */
export function FolderAttachmentRow({
  access,
  onAccessChange,
  onRemove,
  path,
  removeLabel = "Remove",
}: {
  access: FolderAttachment.Access;
  /**
   * Omitted for a folder whose access this row does not own, which leaves the
   * grant stated rather than offered.
   */
  onAccessChange?: (access: FolderAttachment.Access) => void;
  /** Omitted for a folder this row is not the owner of. */
  onRemove?: () => void;
  path: string;
  removeLabel?: string;
}) {
  const [isConfirmingRemove, setConfirmingRemove] = useState(false);
  const name = folderNameFromPath(path);

  const handleOpen = async () => {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: path }),
    );
    if (error) {
      toast.error("Failed to open folder", { description: error.message });
    }
  };

  return (
    <div className="flex items-center gap-1.5 pr-1">
      {/* px-3 is what puts the folder icon under the section heading above it,
          on the same keyline as the file rows. */}
      <SidebarMenuButton
        className="h-auto min-h-14 flex-1 items-center gap-3 px-3 py-2 text-xs hover:bg-muted/50"
        onClick={() => void handleOpen()}
      >
        <MacFolderIcon className="size-8! shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The stored name is the mount name the agent works through
              (`Home-Downloads`), which is not what the user picked; the
              folder's own name and where it lives are. */}
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-muted-foreground/70" title={path}>
            {displayPath(path)}
          </span>
        </div>
      </SidebarMenuButton>
      {onAccessChange ? (
        <FolderAccessControl
          access={access}
          folderName={name}
          onChange={onAccessChange}
        />
      ) : (
        <FolderAccessLabel
          access={access}
          className="text-muted-foreground/70"
          iconOnly
        />
      )}
      {onRemove && (
        <>
          <button
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-foreground/5 hover:opacity-100"
            onClick={() => {
              setConfirmingRemove(true);
            }}
            type="button"
          >
            <XIcon className="size-3" />
            <span className="sr-only">{removeLabel}</span>
          </button>
          {/* Asked rather than undone: detaching is one click beside a control
              the user came here to change, and there is no way back to a folder
              whose path they no longer remember. */}
          <AlertDialog
            onOpenChange={setConfirmingRemove}
            open={isConfirmingRemove}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{`Remove "${name}"?`}</AlertDialogTitle>
                <AlertDialogDescription>
                  The agent loses access to this folder here. Nothing is deleted
                  and the folder stays where it is on your computer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onRemove}>
                  {removeLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
