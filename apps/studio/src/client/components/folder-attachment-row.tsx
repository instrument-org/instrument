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
import { SidebarMenuAction, SidebarMenuButton } from "./ui/sidebar";

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
    <SidebarMenuButton
      className="h-auto min-h-14 items-center gap-3 px-3 py-2 text-xs hover:bg-muted/50"
      onClick={() => void handleOpen()}
    >
      <MacFolderIcon className="size-8! shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The stored name is the mount name the agent works through
            (`Home-Downloads`), which is not what the user picked; the
            folder's own name and where it lives are. */}
        <span className="truncate font-medium">{folderNameFromPath(path)}</span>
        <div className="flex min-w-0 items-center gap-2.5 text-muted-foreground/70">
          <span className="truncate" title={path}>
            {displayPath(path)}
          </span>
          <FolderAccessLabel
            access={access}
            className="text-muted-foreground/70"
            iconOnly
          />
        </div>
      </div>
    </SidebarMenuButton>
  );

  const rowWithContextMenu = onRemove ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenuItems(contextMenuComponents)}
      </ContextMenuContent>
    </ContextMenu>
  ) : (
    row
  );

  return (
    <>
      {rowWithContextMenu}
      {onRemove && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
              <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
              <span className="sr-only">Folder actions</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {renderMenuItems(dropdownMenuComponents)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
