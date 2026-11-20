import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
  /** A row that is on or off, its tick at the row's end. */
  CheckboxItem: React.ComponentType<{
    checked?: boolean;
    children?: React.ReactNode;
    onSelect?: (event: Event) => void;
  }>;
  Item: React.ComponentType<{
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: React.MouseEventHandler;
    onSelect?: (event: Event) => void;
    variant?: "default" | "destructive" | "developer";
  }>;
  Separator: React.ComponentType<{ className?: string }>;
  /** The keys that do what the row does, dimmed at the row's end. */
  Shortcut: React.ComponentType<{ children?: React.ReactNode }>;
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
  CheckboxItem: ContextMenuCheckboxItem,
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubContent: ContextMenuSubContent,
  SubTrigger: ContextMenuSubTrigger,
};

export const dropdownMenuComponents: MenuComponents = {
  CheckboxItem: DropdownMenuCheckboxItem,
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubContent: DropdownMenuSubContent,
  SubTrigger: DropdownMenuSubTrigger,
};
