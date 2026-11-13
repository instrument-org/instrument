import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { contextMenuComponents } from "@/client/components/ui/menu-components";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { cn } from "@/client/lib/utils";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { ArrowLineUpIcon } from "@phosphor-icons/react/ArrowLineUp";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { PushPinIcon } from "@phosphor-icons/react/PushPin";
import { PushPinSlashIcon } from "@phosphor-icons/react/PushPinSlash";
import { XIcon } from "@phosphor-icons/react/X";
import { XSquareIcon } from "@phosphor-icons/react/XSquare";
import { type ReactNode, useRef } from "react";

import { chatMenuGroups } from "./chat-actions";
import { ChatCopyMenu } from "./chat-copy-menu";
import { type Project } from "./chats";
import { ProjectMark } from "./project-mark";
import { type RowAction } from "./row-shell";
import { type TabGroup } from "./tab-groups";

/** What a row's menu does, which the sidebar answers for every row. */
export interface GroupRowMenuActions {
  /** The chat's actions (`useChatActionsFor`); for a group whose chat has not started, its pin alone, as a chat's star. */
  actions: RowAction[];
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
  /** The new-project dialog, which files this group under the project it makes. */
  onNewProject: () => void;
  onNewWindow: () => void;
  /** Files the group under a project, or under none with `null`. */
  onSetProject: (project: null | string) => void;
  projects: Project[];
}

/** A chat's star, which in the sidebar pins its row above the line, or a pin of a group whose chat has not started, offered as one. */
function asPin(action: RowAction): RowAction {
  if (action.id === "star") {
    return {
      ...action,
      icon: <PushPinIcon className="size-3.5" />,
      label: "Pin",
    };
  }
  if (action.id === "unstar") {
    return {
      ...action,
      icon: <PushPinSlashIcon className="size-3.5" />,
      label: "Unpin",
    };
  }
  return action;
}

/**
 * A tab group row's menu, with the chat row's items as the chat list's menu
 * has them: Open in New Window and Duplicate Tab Group; marking the chat
 * read or unread and pinning it; naming the group and filing it under a
 * project; copying its paths; and closing the group, or the groups around
 * it, as a tab's menu closes tabs. A group whose chat has not started has a
 * window of its own, its copy, pinning, its name, its project and the
 * closing. Not modal, as the chat row's is not, so
 * the click that puts it away lands on what it was meant for.
 */
export function GroupRowMenu({
  children,
  entry,
  menu,
  onRename,
}: {
  children: ReactNode;
  entry: TabGroup;
  menu: GroupRowMenuActions;
  /** Starts naming the group in its row (`useGroupRename`). */
  onRename: () => void;
}) {
  // The menu hands focus back to the row as it closes, which would land
  // after the field took it and blur the rename shut.
  const isStartingRename = useRef(false);
  const chat = entry.kind === "chat" ? entry.chat : undefined;
  const filedUnder =
    entry.kind === "chat" ? entry.chat.project : entry.draft.projectId;
  const live = menu.projects.filter((project) => !project.retired);
  const marks = chatMenuGroups(menu.actions).marks.map(asPin);
  const item = (action: RowAction) => (
    <ContextMenuItem key={action.id} onSelect={action.run}>
      {action.icon}
      {action.label}
    </ContextMenuItem>
  );
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
        {marks.length > 0 && (
          <>
            <ContextMenuSeparator />
            {marks.map(item)}
          </>
        )}
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
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CardsThreeIcon className="size-4" />
            Project
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="flex w-56 flex-col p-0">
            {live.length > 0 && (
              <MenuScrollArea className="max-h-80">
                {live.map((project) => (
                  <ContextMenuCheckboxItem
                    checked={filedUnder === project.id}
                    key={project.id}
                    onSelect={() => {
                      // Picking the project it is under takes it off.
                      menu.onSetProject(
                        filedUnder === project.id ? null : project.id,
                      );
                    }}
                  >
                    <ProjectMark project={project} />
                    <span className="truncate">{project.name}</span>
                  </ContextMenuCheckboxItem>
                ))}
              </MenuScrollArea>
            )}
            <div
              className={cn(
                "shrink-0 p-1",
                live.length > 0 && "border-t border-border",
              )}
            >
              <ContextMenuItem onSelect={menu.onNewProject}>
                <PlusIcon className="size-4" />
                New project…
              </ContextMenuItem>
            </div>
          </ContextMenuSubContent>
        </ContextMenuSub>
        {chat && (
          <>
            <ContextMenuSeparator />
            <ChatCopyMenu chat={chat} menu={contextMenuComponents} />
          </>
        )}
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
