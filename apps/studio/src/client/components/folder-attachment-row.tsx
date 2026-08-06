import { FolderAccessLabel } from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
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
  /** Omitted for a folder this row is not the owner of, which leaves no menu. */
  onRemove?: () => void;
  path: string;
  removeLabel?: string;
}) {
  const handleOpen = async () => {
    const [error] = await safe(
      rpcClient.utils.openFolder.call({ folderPath: path }),
    );
    if (error) {
      toast.error("Failed to open folder", { description: error.message });
    }
  };

  const renderMenuItems = ({ Item }: MenuComponents) => (
    <Item onSelect={onRemove} variant="destructive">
      <TrashIcon className="size-4" />
      <span>{removeLabel}</span>
    </Item>
  );

  const row = (
    <div className="group flex items-center gap-x-2.5 pr-3 hover:bg-muted/50">
      <button
        className="flex min-w-0 flex-1 items-center gap-x-2.5 py-2 pl-3 text-left"
        onClick={() => void handleOpen()}
        type="button"
      >
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
      </button>
      {onRemove && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground data-[state=open]:opacity-100">
            <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
            <span className="sr-only">Folder actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {renderMenuItems(dropdownMenuComponents)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  if (!onRemove) {
    return row;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenuItems(contextMenuComponents)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
