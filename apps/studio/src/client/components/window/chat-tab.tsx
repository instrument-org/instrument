import { WorkingDots } from "@/client/components/transcript/task-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  contextMenuComponents,
  dropdownMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { type ReactNode, useRef } from "react";

import { ChatTitleField } from "./chat-title";
import { type ChatRename } from "./use-chat-rename";
import { type TitleArrival } from "./use-title-arrival";

/**
 * The chat's tab, at the top right of its tab group in every state, named
 * for the chat: its title, or "New chat" until it starts, after the bubble,
 * which gives way to the working dots while the agent works. While the chat
 * is shown it is the tab up, on the ground under it: at the tab bar's end
 * while the chat fills the group, and across the column's top while the
 * column is open. Once the group has tabs, a press on it opens and closes
 * the column. Its menu is the chat's, on a right-click anywhere on it and on
 * the caret at its end while the chat is shown.
 */
export function ChatTab({
  badge,
  className,
  isWorking,
  menu,
  onPress,
  rename,
  spans = false,
  state,
  title,
  titleArrival,
}: {
  /** What stands before the caret: the commands the chat left running. */
  badge?: ReactNode;
  /** Where it stands on its row. */
  className?: string;
  isWorking: boolean;
  /** The menu's rows, drawn with the parts of the menu they are in; none until there is a chat or a draft to act on. */
  menu?: ChatTabMenu | undefined;
  onPress: () => void;
  /** Renaming the chat in the tab, for a chat that has started. */
  rename?: ChatRename | undefined;
  /** Whether it spans the column's top rather than standing at the tab bar's end. */
  spans?: boolean;
  /** Whether the chat is on screen, filling the group or in its open column, or put away in its closed column. */
  state: "closed" | "shown";
  title: string;
  titleArrival?: TitleArrival | undefined;
}) {
  const isShown = state === "shown";
  // A menu hands focus back to where it opened as it closes, which would
  // land after the rename field took it and blur the rename shut.
  const isStartingRename = useRef(false);
  const actions = {
    startRename: () => {
      isStartingRename.current = true;
      rename?.start();
    },
  };
  const keepRenameFocus = (event: Event) => {
    if (isStartingRename.current) {
      isStartingRename.current = false;
      event.preventDefault();
    }
  };
  const glyph = (
    <span className="grid size-4 shrink-0 place-items-center text-brand-600 dark:text-brand-400">
      {isWorking ? (
        <WorkingDots />
      ) : (
        <ChatCircleIcon className="size-4" weight="fill" />
      )}
    </span>
  );

  const tab = (
    <div
      className={cn(
        "relative flex h-8 min-w-0 items-center rounded-xl text-sm font-medium [-webkit-app-region:no-drag]",
        spans ? "flex-1" : "w-60 shrink",
        isShown
          ? "text-foreground"
          : "text-foreground/65 hover:bg-foreground/8 hover:text-foreground",
        className,
      )}
      data-chat-tab=""
      {...(isShown ? { "data-joined": "" } : {})}
    >
      {rename?.isEditing ? (
        <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 pl-2.5">
          {glyph}
          <ChatTitleField
            className="text-sm font-medium"
            grow
            rename={rename}
            width={undefined}
          />
        </div>
      ) : (
        <button
          aria-label={title}
          aria-pressed={isShown}
          className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 pr-1 pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={onPress}
          // A press here selects nothing, so it leaves the keyboard where it was.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          title={title}
          type="button"
        >
          {glyph}
          <span className="min-w-0 flex-1 overflow-hidden tab-title-fade whitespace-nowrap">
            <span
              className={titleArrival?.className}
              onAnimationEnd={titleArrival?.onAnimationEnd}
            >
              {title}
            </span>
          </span>
        </button>
      )}
      {badge}
      {isShown && menu && !rename?.isEditing && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Chat menu"
              className="mr-1.5 grid size-5 shrink-0 cursor-default place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground"
              type="button"
            >
              <CaretDownIcon className="size-3" weight="bold" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            onCloseAutoFocus={keepRenameFocus}
          >
            <MenuRows
              actions={actions}
              components={dropdownMenuComponents}
              rows={menu}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  if (!menu) {
    return tab;
  }
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={keepRenameFocus}>
        <MenuRows
          actions={actions}
          components={contextMenuComponents}
          rows={menu}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

type ChatTabMenu = (
  components: MenuComponents,
  actions: { startRename: () => void },
) => ReactNode;

/** The chat tab's menu rows, drawn with the parts of the menu they open in. */
function MenuRows({
  actions,
  components,
  rows,
}: {
  actions: { startRename: () => void };
  components: MenuComponents;
  rows: ChatTabMenu;
}) {
  return rows(components, actions);
}
