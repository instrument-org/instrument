import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { ArrowLineUpIcon } from "@phosphor-icons/react/ArrowLineUp";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode, useRef } from "react";

/** What a row's menu does, which the sidebar answers for every row. */
export interface GroupRowMenuActions {
  /** Whether the group is pinned above the line, by its own pin. */
  isPinned: boolean;
  onClose: () => void;
  /**
   * Closes the groups listed above this one, below it, or every other, as a
   * tab's menu closes the tabs around it, pinned ones left open; none where
   * there is nothing to close.
   */
  onCloseAbove: (() => void) | undefined;
  onCloseBelow: (() => void) | undefined;
  onCloseOthers: (() => void) | undefined;
  /** A copy of the group just below it, with its tabs, up in the window. */
  onDuplicate: () => void;
  onNewWindow: () => void;
  /** Pins the group, or takes its pin off. */
  onTogglePin: () => void;
}

/**
 * A tab group row's menu, which acts on the group as a whole whatever its
 * tabs show: Open in New Window and Duplicate Tab Group; naming the group
 * and pinning it; and closing the group, or the groups around it, as a
 * tab's menu closes tabs. What acts on one chat in the group is in that
 * chat's tab menu. Not modal, as the chat row's is not, so the click that
 * puts it away lands on what it was meant for.
 */
export function GroupRowMenu({
  children,
  menu,
  onRename,
}: {
  children: ReactNode;
  menu: GroupRowMenuActions;
  /** Starts naming the group in its row (`useGroupRename`). */
  onRename: () => void;
}) {
  // The menu hands focus back to the row as it closes, which would land
  // after the field took it and blur the rename shut.
  const isStartingRename = useRef(false);
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (isStartingRename.current) {
            isStartingRename.current = false;
            event.preventDefault();
          }
        }}
      >
        <ContextMenuItem onSelect={menu.onNewWindow}>
          <AppWindowIcon className="size-4" />
          Open in New Window
        </ContextMenuItem>
        <ContextMenuItem onSelect={menu.onDuplicate}>
          <CopyIcon className="size-4" />
          Duplicate Tab Group
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            isStartingRename.current = true;
            onRename();
          }}
        >
          <PencilSimpleIcon className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={menu.onTogglePin}>
          {menu.isPinned ? (
            <PushPinSlashIcon className="size-3.5" />
          ) : (
            <PushPinIcon className="size-3.5" />
          )}
          {menu.isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={menu.onClose}>
          <XIcon className="size-4" />
          Close Tab Group
        </ContextMenuItem>
        {menu.onCloseOthers && (
          <ContextMenuItem onSelect={menu.onCloseOthers}>
            <XSquareIcon className="size-4" />
            Close Other Tab Groups
          </ContextMenuItem>
        )}
        {menu.onCloseAbove && (
          <ContextMenuItem onSelect={menu.onCloseAbove}>
            <ArrowLineUpIcon className="size-4" />
            Close Tab Groups Above
          </ContextMenuItem>
        )}
        {menu.onCloseBelow && (
          <ContextMenuItem onSelect={menu.onCloseBelow}>
            <ArrowLineDownIcon className="size-4" />
            Close Tab Groups Below
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
