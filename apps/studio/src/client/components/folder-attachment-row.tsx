import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
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

interface ExtraItem {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}

export function FolderAttachmentRow({
  additionalMenuItems,
  name,
  onRemove,
  path,
  removeLabel = "Remove",
}: {
  additionalMenuItems?: ExtraItem[];
  name: string;
  onRemove: () => void;
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
        {additionalMenuItems && additionalMenuItems.length > 0 && (
          <>
            {additionalMenuItems.map((item) => (
              <Item key={item.label} onSelect={item.onSelect}>
                {item.icon}
                <span>{item.label}</span>
              </Item>
            ))}
            <Separator />
          </>
        )}
        <Item onSelect={() => void handleReveal()}>
          <RevealInFolderIcon className="size-4" />
          <span>{revealLabel}</span>
        </Item>
        <Separator />
        <Item onSelect={onRemove} variant="destructive">
          <TrashIcon className="size-4" />
          <span>{removeLabel}</span>
        </Item>
      </>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex items-center gap-x-2.5 px-3 py-2 hover:bg-muted/50">
          <MacFolderIcon className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground/70">
              {path}
            </span>
          </div>
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
