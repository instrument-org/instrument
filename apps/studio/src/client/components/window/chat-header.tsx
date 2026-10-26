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
import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation } from "@tanstack/react-query";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { chatMenuGroups, useChatActions } from "./chat-actions";
import { ChatStatusLine } from "./chat-status-line";
import { TopicPill } from "./chat-row";
import { ChatTitleButton, ChatTitleField } from "./chat-title";
import { type Chat, type Topic } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { type RowAction } from "./row-shell";
import { TopicMark } from "./topic-mark";
import { TopicPicker } from "./topic-picker";
import { type ChatRename, useChatRename } from "./use-chat-rename";
import { useTitleArrival } from "./use-title-arrival";

/**
 * The head over a chat's conversation, wherever the chat is shown: beside
 * the inbox and popped out into its small window alike. Its title in the
 * middle, which opens the chat's menu, with the topic it is filed under
 * after it, and under the title the one line saying where its work stands
 * (`ChatStatusLine`), which is the chat's loading state and lists its
 * tasks. At the right, whatever the place it is shown in adds: beside the inbox the glyph that pops the conversation out (lit while
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
  onOpenTask,
  onSetTopic,
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
  /** Opens one of the chat's tasks beside it, from the list under its title. */
  onOpenTask: (sessionId: StoreId.Session) => void;
  onSetTopic: (topic: null | string) => void;
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
                menu={{ onArchived, onViewTasks }}
                onDelete={() => {
                  setDeleting(true);
                }}
                onNewTopic={onNewTopic}
                onSetTopic={onSetTopic}
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
 * A chat's title and the topic it is filed under, as the chat's head and
 * its popped-out window both draw them: the title, with its caret, opens the
 * chat's menu, whose Rename puts a field in the title's place, and the
 * topic follows it the way mail puts a label after a subject. The title
 * gives way first, truncating; on a narrow head the topic stands as its
 * mark alone.
 */
function ChatHeading({
  centered = false,
  chat,
  menu,
  onDelete,
  onNewTopic,
  onSetTopic,
  titleClassName,
  topics,
}: {
  /** Whether the title and its topic stand in the middle of the room, as the chat's head has them. */
  centered?: boolean;
  chat: Chat;
  /** What the menu offers beyond what every head's does. */
  menu: Pick<ComponentProps<typeof ChatMenu>, "onArchived" | "onViewTasks">;
  onDelete: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  onSetTopic: (topic: null | string) => void;
  /** The type the title is set in, which its rename field takes too. */
  titleClassName: string;
  topics: Topic[];
}) {
  const filed = topics.find((entry) => entry.id === chat.topic);
  const chatRename = useChatRename(chat);
  const titleArrival = useTitleArrival(chat);
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
  // Picking the topic the chat is under takes it off; any other moves it.
  const pickTopic = (id: string) => {
    onSetTopic(chat.topic === id ? null : id);
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
            topicMenu={{ onNew: onNewTopic, onPick: pickTopic, topics }}
            trigger={
              <ChatTitleButton
                arrival={titleArrival}
                className={titleClassName}
                ref={setTitleButton}
                title={chat.title}
              />
            }
          />
        )}
      </h2>
      {/* Pressing it opens the topic picker every filing shares. No
          dashed slot in the head: a chat with no topic is filed from the
          menu. */}
      {filed && (
        <TopicPicker
          chosen={new Set([filed.id])}
          onNew={onNewTopic}
          onToggle={pickTopic}
          topics={topics}
        >
          <button
            aria-label="Topic"
            className="flex shrink-0 items-center gap-1"
            type="button"
          >
            <TopicPill compact="narrow" topic={filed} />
          </button>
        </TopicPicker>
      )}
    </div>
  );
}

/**
 * The chat's own menu, opened from its title: while the chat works, Stop,
 * which ends its turn and every task's; then the inbox row's menu in the
 * same groups and order (see `chatMenuGroups`), with renaming it, which
 * opens the title's field, and its tasks among the ways to organize it, and
 * deleting it at the foot. Its topic is the pill beside the title.
 */
function ChatMenu({
  chat,
  onArchived,
  onDelete,
  onViewTasks,
  rename,
  topicMenu,
  trigger,
}: {
  chat: Chat;
  /** After the chat is archived from this menu, for a head that should go with it. */
  onArchived?: () => void;
  onDelete: () => void;
  /** Opens the chat's tasks, when the head can reach them. */
  onViewTasks?: () => void;
  rename: ChatRename;
  /** The topics to file the chat under, as a submenu, when the head that owns the menu files it. */
  topicMenu?: {
    onNew: (name?: string) => void;
    onPick: (id: string) => void;
    topics: Topic[];
  };
  /** What opens it: the chat's title. */
  trigger: ReactNode;
}) {
  const groups = chatMenuGroups(useChatActions(chat));
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
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
        {chat.state === "working" && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                stop.mutate({ id: chat.id });
              }}
            >
              <StopIcon className="size-3.5" />
              Stop
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
        {topicMenu && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TagIcon className="size-3.5" />
              Topic
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="flex w-56 flex-col p-0">
              <MenuScrollArea className="max-h-80">
                {topicMenu.topics
                  .filter((entry) => !entry.retired)
                  .map((entry) => (
                    <DropdownMenuCheckboxItem
                      checked={chat.topic === entry.id}
                      key={entry.id}
                      onSelect={() => {
                        topicMenu.onPick(entry.id);
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
                    topicMenu.onNew();
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
        {groups.feedback.map(item)}
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
