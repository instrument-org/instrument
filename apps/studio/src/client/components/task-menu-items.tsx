import { type MenuComponents } from "@/client/components/ui/menu-components";
import {
  PencilSimpleLineIcon,
  PushPinIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { type ReactNode } from "react";

/**
 * The shared skeleton of a task's action menu, rendered under both a dropdown
 * (the "..." button) and a context menu (right click) via {@link MenuComponents}.
 * Pin / Rename / Delete are identical everywhere; the context-specific piece is
 * the `extras` slot (change-project + dev items in the sidebar, remove-from-project
 * in a project row). Every item uses `onSelect` so keyboard and pointer activation
 * behave the same.
 */
export function TaskMenuItems({
  extras,
  isPinned,
  menuComponents,
  onDelete,
  onRename,
  onTogglePin,
}: {
  extras?: ReactNode;
  isPinned: boolean;
  menuComponents: MenuComponents;
  onDelete: () => void;
  onRename: () => void;
  onTogglePin: () => void;
}) {
  const { Item, Separator } = menuComponents;
  return (
    <>
      <Item onSelect={onTogglePin}>
        <PushPinIcon className="text-muted-foreground" />
        <span>{isPinned ? "Unpin" : "Pin"}</span>
      </Item>
      <Item onSelect={onRename}>
        <PencilSimpleLineIcon className="text-muted-foreground" />
        <span>Rename</span>
      </Item>
      {extras}
      <Separator />
      <Item onSelect={onDelete} variant="destructive">
        <TrashIcon className="size-4" />
        <span>Delete</span>
      </Item>
    </>
  );
}
