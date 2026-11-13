import { WorkingDots } from "@/client/components/transcript/task-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  contextMenuComponents,
  type MenuComponents,
} from "@/client/components/ui/menu-components";
import { cn } from "@/client/lib/utils";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { ChatTitleField } from "./chat-title";
import { type ChatRename } from "./use-chat-rename";
import { type TitleArrival } from "./use-title-arrival";

/**
 * The chat's tab, named for the chat: its title, or "New chat" until it
 * starts, after the bubble, which gives way to the working dots while the
 * agent works. While the chat is the whole group it is the one tab on the
 * tab bar, lifted off it as the tab up is; while the chat has a card beside
 * the work it is that card's head. The X at its end closes it, and a
 * right-click anywhere on it opens the chat's menu. A closed card leaves
 * `ClosedChatTab` in its place.
 */
export function ChatTab({
  badge,
  className,
  isWorking,
  menu,
  onClose,
  rename,
  stands,
  title,
  titleArrival,
}: {
  /** What stands before the X: the commands the chat left running. */
  badge?: ReactNode;
  /** Where it stands on its row. */
  className?: string;
  isWorking: boolean;
  /** The menu's rows, drawn with the parts of the menu they are in; none until there is a chat to act on. */
  menu?: ChatTabMenu | undefined;
  onClose: () => void;
  /** Renaming the chat in the tab, for a chat that has started. */
  rename?: ChatRename | undefined;
  /** Where it stands: the tab up while the chat is the whole group, or the head of the chat's card. */
  stands: "head" | "up";
  title: string;
  titleArrival?: TitleArrival | undefined;
}) {
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
  const glyph = <ChatGlyph isWorking={isWorking} />;

  const tab = (
    <div
      className={cn(
        "relative flex h-8 min-w-0 items-center gap-2 rounded-xl pr-1.5 pl-2.5 text-sm font-medium text-foreground [-webkit-app-region:no-drag]",
        stands === "head" ? "flex-1" : "w-60 shrink shadow-xs-soft",
        className,
      )}
      data-chat-tab=""
      {...(stands === "up"
        ? {
            style: {
              backgroundColor: "var(--tab-selected, var(--background))",
            },
          }
        : {})}
    >
      {glyph}
      {rename?.isEditing ? (
        <ChatTitleField
          className="text-sm font-medium"
          grow
          rename={rename}
          width={undefined}
        />
      ) : (
        <span
          className="min-w-0 flex-1 cursor-default overflow-hidden tab-title-fade whitespace-nowrap"
          // A press on the name selects nothing, so it leaves the keyboard where it was.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          title={title}
        >
          <span
            className={titleArrival?.className}
            onAnimationEnd={titleArrival?.onAnimationEnd}
          >
            {title}
          </span>
        </span>
      )}
      {badge}
      {!rename?.isEditing && (
        <button
          aria-label={`Close ${title}`}
          className="grid size-5 shrink-0 cursor-default place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          onClick={onClose}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
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

/**
 * The chat's tab while its card is closed: at the right end of the work's
 * tabs, as wide as its title up to a tab's width, and dim as a tab not up
 * is, where a press opens the card again. A title cut short fades out at its
 * end, as a tab's does.
 */
export function ClosedChatTab({
  isWorking,
  onOpen,
  title,
}: {
  isWorking: boolean;
  onOpen: () => void;
  title: string;
}) {
  const name = useRef<HTMLSpanElement>(null);
  const [isCut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = name.current;
    if (element) {
      setCut(element.scrollWidth > element.clientWidth);
    }
  }, [title]);
  return (
    <button
      aria-label={`Show ${title}`}
      className="ml-1 flex h-8 max-w-60 min-w-0 shrink cursor-default items-center gap-2 rounded-xl px-2.5 text-left text-sm font-medium text-foreground/55 [-webkit-app-region:no-drag] hover:bg-foreground/8 hover:text-foreground dark:text-foreground/65"
      onClick={onOpen}
      // A press here selects nothing, so it leaves the keyboard where it was.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      title={title}
      type="button"
    >
      <ChatGlyph isWorking={isWorking} />
      <span
        className={cn(
          "min-w-0 overflow-hidden whitespace-nowrap",
          isCut && "tab-title-fade",
        )}
        ref={name}
      >
        {title}
      </span>
    </button>
  );
}

/** The chat's mark on its tab: the bubble, or the working dots while the agent works. */
function ChatGlyph({ isWorking }: { isWorking: boolean }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center text-brand-600 dark:text-brand-400">
      {isWorking ? (
        <WorkingDots />
      ) : (
        <ChatCircleIcon className="size-4" weight="fill" />
      )}
    </span>
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
