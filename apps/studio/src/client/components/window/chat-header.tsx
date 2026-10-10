import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { MenuScrollArea } from "@/client/components/ui/menu-scroll-area";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { chatMenuGroups, useChatActions } from "./chat-actions";
import { ChatActivity } from "./chat-activity";
import { ChatStatusLine } from "./chat-status-line";
import { TopicPill } from "./chat-row";
import { ChatTitleButton, ChatTitleField } from "./chat-title";
import { type Chat, type Topic } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { type RowAction } from "./row-shell";
import { TopicMark } from "./topic-mark";
import { TopicPicker } from "./topic-picker";
import { type ChatRename, useChatRename } from "./use-chat-rename";

/**
 * The head over a chat's conversation, wherever the chat is shown: beside
 * the inbox and popped out into its small window alike. Its title in the
 * middle, which opens the chat's menu, with the topics it is filed under
 * after it, and under the title the one line saying where its work stands
 * (`ChatStatusLine`), which is the chat's loading state. At the right, the
 * mark that lists the chat's tasks, then whatever the place it is shown in
 * adds: beside the inbox the glyph that pops the conversation out (lit while
 * it is out, when pressing it brings the conversation back) and the pane
 * toggle while the pane is closed; popped out, the window's own buttons. The
 * two sides keep one width, the wider one's, so the title stands in the
 * window's middle however unevenly they are filled, and takes all the room
 * between them before it gives way, truncating.
 */
export function ChatHeader({
  chat,
  fallbackTitle = "Chat",
  leading,
  onArchived,
  onDeleted,
  onNewTopic,
  onOpenInChats,
  onOpenTask,
  onSetTopics,
  onViewTasks,
  popOut,
  topics,
  trailing,
}: {
  chat: Chat | undefined;
  /** The title while there is no chat yet: the words just sent, once there are any. */
  fallbackTitle?: string;
  /** What sits ahead of the title: the toggle that puts the inbox away. */
  leading?: ReactNode;
  /** After the chat is archived from its menu, so the window can put it away. */
  onArchived?: () => void;
  /** Told once the chat has been deleted, so the window can put it away. */
  onDeleted: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  /** Opens the chat among the chats, from its menu, where the head is not already there. */
  onOpenInChats?: () => void;
  /** Opens one of the chat's tasks beside it, from the work in flight at the head's right. */
  onOpenTask: (taskId: TaskId) => void;
  onSetTopics: (topics: string[]) => void;
  /** Opens the chat's tasks as a tab in its group, when the head can reach them. */
  onViewTasks?: () => void;
  /** Whether the conversation is in its small view, and the press that sends it there or brings it back. */
  popOut?: { isOut: boolean; onToggle: () => void };
  topics: Topic[];
  /** What sits at the head's right: the pane toggle while the pane is closed, or the popped-out window's buttons. */
  trailing?: ReactNode;
}) {
  const [isDeleting, setDeleting] = useState(false);
  const sideWidth = useWiderSide();
  return (
    <>
      {chat && (
        <DeleteChatDialog
          chat={chat}
          onDeleted={onDeleted}
          onOpenChange={setDeleting}
          open={isDeleting}
        />
      )}
      {/* Three columns, the outer two both as wide as the wider side's
          contents, so the title stands in the middle of the conversation
          whatever sits at either side. The middle one takes the rest rather
          than sizing to the title, since the heading is a container and has
          no width of its own. */}
      <div
        className="@container/head grid h-14 w-full min-w-0 shrink-0 grid-cols-[var(--side,max-content)_minmax(0,1fr)_var(--side,max-content)] items-start gap-x-2 bg-background px-3 pt-2"
        style={
          sideWidth.width === undefined
            ? undefined
            : // A custom property, which CSSProperties has no key for.
              ({ "--side": `${sideWidth.width}px` } as CSSProperties)
        }
      >
        <div className="flex h-8 items-center">
          <div
            className="flex w-max items-center gap-x-1"
            ref={sideWidth.leading}
          >
            {leading}
          </div>
        </div>
        <div className="flex min-w-0 flex-col items-center">
          <div className="flex h-8 w-full min-w-0 items-center">
            {chat ? (
              <ChatHeading
                centered
                chat={chat}
                menu={{ onArchived, onOpenInChats, onViewTasks }}
                onDelete={() => {
                  setDeleting(true);
                }}
                onNewTopic={onNewTopic}
                onSetTopics={onSetTopics}
                titleClassName="text-sm font-medium"
                topics={topics}
              />
            ) : (
              <h2 className="mx-auto min-w-0 truncate text-sm font-medium">
                {fallbackTitle}
              </h2>
            )}
          </div>
          {chat && (
            <div className="-mt-1 flex h-4 max-w-full min-w-0 justify-center">
              <ChatStatusLine chat={chat} onOpenTask={onOpenTask} />
            </div>
          )}
        </div>
        <div className="flex h-8 items-center justify-end">
          <div
            className="flex w-max items-center gap-x-1"
            ref={sideWidth.trailing}
          >
            {/* The step itself is the line under the title, so this stands
              as its mark alone. */}
            {chat && (
              <ChatActivity
                chatId={chat.id}
                isCompact
                onOpen={onOpenTask}
                tasks={chat.runningTasks}
              />
            )}
            {popOut && (
              <ToolbarTooltip label={popOut.isOut ? "Bring back" : "Pop out"}>
                <Button
                  aria-label={popOut.isOut ? "Bring back" : "Pop out"}
                  aria-pressed={popOut.isOut}
                  className={cn(
                    toolbarClassName({ pressed: popOut.isOut }),
                    popOut.isOut &&
                      "bg-brand-100 text-brand-700 hover:bg-brand-100 hover:text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
                  )}
                  onClick={popOut.onToggle}
                  size="icon-sm"
                  variant="ghost"
                >
                  <PictureInPictureIcon className="size-4" />
                </Button>
              </ToolbarTooltip>
            )}
            {trailing}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The width both sides of the head take: the wider side's contents, read in
 * layout px (`offsetWidth`, not a rect) since the app scales with CSS zoom,
 * and read again whenever either side's contents change size.
 */
function useWiderSide() {
  const [leading, setLeading] = useState<HTMLDivElement | null>(null);
  const [trailing, setTrailing] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const sides = [leading, trailing].filter((side) => side !== null);
    const measure = () => {
      setWidth(Math.max(0, ...sides.map((side) => side.offsetWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const side of sides) {
      observer.observe(side);
    }
    return () => {
      observer.disconnect();
    };
  }, [leading, trailing]);
  return { leading: setLeading, trailing: setTrailing, width };
}

/**
 * A chat's title and the topics it is filed under, as the chat's head and
 * its popped-out window both draw them: the title, with its caret, opens the
 * chat's menu, whose Rename puts a field in the title's place, and the
 * topics follow it the way mail puts a label after a subject. The title
 * gives way first, truncating; on a narrow head the topics stand as their
 * marks alone.
 */
export function ChatHeading({
  centered = false,
  chat,
  menu,
  onDelete,
  onNewTopic,
  onSetTopics,
  titleClassName,
  topics,
}: {
  /** Whether the title and its topics stand in the middle of the room, as the chat's head has them. */
  centered?: boolean;
  chat: Chat;
  /** What the menu offers beyond what every head's does. */
  menu: Pick<
    ComponentProps<typeof ChatMenu>,
    "onArchived" | "onOpenInChats" | "onViewTasks"
  >;
  onDelete: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  onSetTopics: (topics: string[]) => void;
  /** The type the title is set in, which its rename field takes too. */
  titleClassName: string;
  topics: Topic[];
}) {
  // Every topic the chat is filed under, in the order it was filed.
  const filed = chat.topics.flatMap((id) => {
    const topic = topics.find((entry) => entry.id === id);
    return topic ? [topic] : [];
  });
  const chatRename = useChatRename(chat);
  // The title's width as renaming begins, which the field opens at, read
  // in layout px (offsetWidth, not a rect) since the app scales with CSS zoom.
  const [titleButton, setTitleButton] = useState<HTMLButtonElement | null>(
    null,
  );
  const [fieldWidth, setFieldWidth] = useState<number>();
  const rename = {
    ...chatRename,
    start: () => {
      setFieldWidth(titleButton?.offsetWidth);
      chatRename.start();
    },
  };
  const toggleTopic = (id: string) => {
    onSetTopics(
      chat.topics.includes(id)
        ? chat.topics.filter((entry) => entry !== id)
        : [...chat.topics, id],
    );
  };
  return (
    <div
      className={cn(
        "@container/chathead flex min-w-0 flex-1 items-center gap-x-2",
        centered && "justify-center",
      )}
    >
      {/* The title opens the chat's menu, Rename among it; renaming puts
          the field in the title's place. */}
      <h2 className="flex min-w-0">
        {rename.isEditing ? (
          <ChatTitleField
            className={titleClassName}
            rename={rename}
            width={fieldWidth}
          />
        ) : (
          <ChatMenu
            {...menu}
            chat={chat}
            onDelete={onDelete}
            rename={rename}
            topicsMenu={{ onNew: onNewTopic, onToggle: toggleTopic, topics }}
            trigger={
              <ChatTitleButton
                className={titleClassName}
                ref={setTitleButton}
                title={chat.title}
              />
            }
          />
        )}
      </h2>
      {/* Pressing them opens the topic picker every filing shares. No
          dashed slot in the head: a chat with no topics is filed from the
          menu. */}
      {filed.length > 0 && (
        <TopicPicker
          chosen={new Set(chat.topics)}
          onNew={onNewTopic}
          onToggle={toggleTopic}
          topics={topics}
        >
          <button
            aria-label="Topics"
            className="flex shrink-0 items-center gap-1"
            type="button"
          >
            {filed.map((topic, index) => (
              <TopicPill
                compact={index === 0 ? "narrow" : true}
                key={topic.id}
                topic={topic}
              />
            ))}
          </button>
        </TopicPicker>
      )}
    </div>
  );
}

/**
 * The chat's own menu, opened from its title: the inbox row's menu in the
 * same groups and order (see `chatMenuGroups`), with renaming it, which
 * opens the title's field, and its tasks among the ways to organize it, and
 * deleting it at the foot. Its topics are the pills beside the title.
 */
export function ChatMenu({
  chat,
  onArchived,
  onDelete,
  onOpenInChats,
  onViewTasks,
  rename,
  topicsMenu,
  trigger,
}: {
  chat: Chat;
  /** After the chat is archived from this menu, for a head that should go with it. */
  onArchived?: () => void;
  onDelete: () => void;
  /** Opens the chat in Chats, for a head that is not already there. */
  onOpenInChats?: () => void;
  /** Opens the chat's tasks, when the head can reach them. */
  onViewTasks?: () => void;
  rename: ChatRename;
  /** The topics to file the chat under, as a submenu, when the head that owns the menu files it. */
  topicsMenu?: {
    onNew: (name?: string) => void;
    onToggle: (id: string) => void;
    topics: Topic[];
  };
  /** What opens it: the chat's title. */
  trigger: ReactNode;
}) {
  const groups = chatMenuGroups(useChatActions(chat));
  const item = (action: RowAction) => (
    <DropdownMenuItem
      key={action.id}
      onSelect={action.run}
      variant={action.developerMode ? "developer" : "default"}
    >
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
  // The menu hands focus back to its trigger as it closes, which would land
  // after the field took it and blur the rename shut.
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (renaming.current) {
            renaming.current = false;
            event.preventDefault();
          }
        }}
      >
        {onOpenInChats && (
          <>
            <DropdownMenuItem onSelect={onOpenInChats}>
              <ChatsCircleIcon className="size-3.5" />
              Open in Chats
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {groups.marks.map(item)}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            rename.start();
          }}
        >
          <PencilSimpleIcon className="size-3.5" />
          Rename
        </DropdownMenuItem>
        {topicsMenu && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TagIcon className="size-3.5" />
              Topics
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="flex w-56 flex-col p-0">
              <MenuScrollArea className="max-h-80">
                {topicsMenu.topics
                  .filter((entry) => !entry.retired)
                  .map((entry) => (
                    <DropdownMenuCheckboxItem
                      checked={chat.topics.includes(entry.id)}
                      key={entry.id}
                      // A chat can be under several topics, so a pick
                      // leaves the list up for the next.
                      onSelect={(event) => {
                        event.preventDefault();
                        topicsMenu.onToggle(entry.id);
                      }}
                    >
                      <TopicMark topic={entry} />
                      <span className="truncate">{entry.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
              </MenuScrollArea>
              <div className="shrink-0 border-t border-border p-1">
                <DropdownMenuItem
                  onSelect={() => {
                    topicsMenu.onNew();
                  }}
                >
                  <PlusIcon className="size-3.5" />
                  New topic…
                </DropdownMenuItem>
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {onViewTasks && (
          <DropdownMenuItem
            onSelect={() => {
              onViewTasks();
            }}
          >
            <ListChecksIcon className="size-3.5" />
            View tasks
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {groups.files.map(item)}
        <DropdownMenuSeparator />
        {groups.put.map((action) =>
          action.id === "archive"
            ? item({
                ...action,
                run: () => {
                  action.run();
                  onArchived?.();
                },
              })
            : item(action),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <TrashIcon className="size-3.5" />
          Delete chat…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
