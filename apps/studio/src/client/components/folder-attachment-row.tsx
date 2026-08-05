import { FolderAccessLabel } from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type FolderAttachment } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { DotsThreeOutlineVerticalIcon, TrashIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "./ui/menu-components";

export function FolderAttachmentRow({
  access,
  onRemove,
  path,
  removeLabel = "Remove",
}: {
  access: FolderAttachment.Access;
  /** Omitted for a folder this row is not the owner of, leaving reveal alone. */
  onRemove?: () => void;
  path: string;
  removeLabel?: string;
}) {
  const handleReveal = async () => {
    const [error] = await safe(
      rpcClient.utils.showFileInFolder.call({ filepath: path }),
    );
    if (error) {
      toast.error(`Failed to ${getRevealInFolderLabel().toLowerCase()}`, {
        description: error.message,
      });
    }
  };

  const revealLabel = getRevealInFolderLabel();

  const renderMenuItems = (menuComponents: MenuComponents) => {
    const { Item, Separator } = menuComponents;
    return (
      <>
        <Item onSelect={() => void handleReveal()}>
          <RevealInFolderIcon className="size-4" />
          <span>{revealLabel}</span>
        </Item>
        {onRemove && (
          <>
            <Separator />
            <Item onSelect={onRemove} variant="destructive">
              <TrashIcon className="size-4" />
              <span>{removeLabel}</span>
            </Item>
          </>
        )}
      </>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-center gap-x-2.5 px-3 py-2 hover:bg-muted/50">
          <MacFolderIcon className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* The stored name is the mount name the agent works through
                (`Home-Downloads`), which is not what the user picked; the
                folder's own name and where it lives are. */}
            <span className="truncate text-xs font-medium">
              {folderNameFromPath(path)}
            </span>
            <span
              className="truncate text-xs text-muted-foreground/70"
              title={path}
            >
              {displayPath(path)}
            </span>
          </div>
          <FolderAccessLabel access={access} />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground data-[state=open]:opacity-100">
              <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
              <span className="sr-only">Folder actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {renderMenuItems(dropdownMenuComponents)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenuItems(contextMenuComponents)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
