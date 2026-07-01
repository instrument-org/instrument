import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/client/components/ui/dropdown-menu";

// DropdownMenu* and ContextMenu* wrap the same underlying MenuPrimitive but each
// Radix package creates its own menu scope, so an item resolves against whichever
// package it came from. To author a menu item list once and render it under both a
// dropdown (overflow "...") and a context menu (right click), callers take one of
// these bags and use its members instead of importing a specific package's parts.
export interface MenuComponents {
  Item: React.ComponentType<{
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: React.MouseEventHandler;
    onSelect?: (event: Event) => void;
    variant?: "default" | "destructive";
  }>;
  Separator: React.ComponentType<{ className?: string }>;
  Sub: React.ComponentType<{ children?: React.ReactNode }>;
  SubContent: React.ComponentType<{
    children?: React.ReactNode;
    className?: string;
  }>;
  SubTrigger: React.ComponentType<{
    children?: React.ReactNode;
    className?: string;
  }>;
}

export const contextMenuComponents: MenuComponents = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubContent: ContextMenuSubContent,
  SubTrigger: ContextMenuSubTrigger,
};

export const dropdownMenuComponents: MenuComponents = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubContent: DropdownMenuSubContent,
  SubTrigger: DropdownMenuSubTrigger,
};
