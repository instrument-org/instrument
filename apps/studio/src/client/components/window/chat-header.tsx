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
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";

import { chatMenuGroups, useChatActions } from "./chat-actions";
import { TopicPill } from "./chat-row";
import { ChatTitle } from "./chat-title";
import { type Chat, type Topic } from "./chats";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { type RowAction } from "./row-shell";
import { TopicMark } from "./topic-mark";
import { TopicPicker } from "./topic-picker";
import { type ChatRename, useChatRename } from "./use-chat-rename";

/**
 * The head over a chat's conversation, the way a task's page heads its
 * chat: its title at the left, which renames the chat when clicked, the
 * topics it is filed under after it, and the chat's own menu hugging them,
 * and at the right the glyph that pops the conversation out into its small
 * view in the corner (lit while it is out, when pressing it brings the
 * conversation back), then the pane toggle while the pane is closed. No way out of the chat here: the
 * chat stays beside the inbox until the inbox is dragged over it. Nothing
 * under the head but air: the transcript starts below.
 */
export function ChatHeader({
  chat,
  leading,
  onDeleted,
  onNewTopic,
  onSetTopics,
  onViewTasks,
  popOut,
  topics,
  trailing,
}: {
  chat: Chat | undefined;
  /** What sits ahead of the title: the toggle that puts the inbox away. */
  leading?: ReactNode;
  /** Told once the chat has been deleted, so the window can put it away. */
  onDeleted: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  onSetTopics: (topics: string[]) => void;
  /** Opens the chat's tasks as a tab in its group, when the head can reach them. */
  onViewTasks?: () => void;
  /** Whether the conversation is in its small view, and the press that sends it there or brings it back. */
  popOut?: { isOut: boolean; onToggle: () => void };
  topics: Topic[];
  /** What sits at the head's right: the pane toggle while the pane is closed. */
  trailing?: ReactNode;
}) {
  const [isDeleting, setDeleting] = useState(false);
  return (
    <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
      {chat && (
        <DeleteChatDialog
          chat={chat}
          onDeleted={onDeleted}
          onOpenChange={setDeleting}
          open={isDeleting}
        />
      )}
      <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
        {leading}
        {chat ? (
          <ChatHeading
            chat={chat}
            menu={{ onViewTasks }}
            onDelete={() => {
              setDeleting(true);
            }}
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            titleClassName="text-sm font-medium"
            topics={topics}
          />
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">Chat</h2>
        )}
      </div>
      {(popOut !== undefined || Boolean(trailing)) && (
        <div className="flex shrink-0 items-center gap-x-1">
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
      )}
    </div>
  );
}

/**
 * A chat's title, the topics it is filed under and its menu, as the chat's
 * head and its popped-out window both draw them: the title renames the chat
 * when clicked, the topics after it the way mail puts a label after a
 * subject, and the menu hugging them. The title gives way first, truncating;
 * on a narrow head the topics stand as their marks alone, and nothing is
 * ever drawn over the menu.
 */
export function ChatHeading({
  chat,
  menu,
  onDelete,
  onNewTopic,
  onSetTopics,
  titleClassName,
  topics,
}: {
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
  const rename = useChatRename(chat);
  const toggleTopic = (id: string) => {
    onSetTopics(
      chat.topics.includes(id)
        ? chat.topics.filter((entry) => entry !== id)
        : [...chat.topics, id],
    );
  };
  return (
    <div className="@container/chathead flex min-w-0 flex-1 items-center gap-x-2">
      <h2 className="flex min-w-0">
        <ChatTitle
          className={titleClassName}
          rename={rename}
          title={chat.title}
        />
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
      <ChatMenu
        {...menu}
        chat={chat}
        onDelete={onDelete}
        rename={rename}
        topicsMenu={{ onNew: onNewTopic, onToggle: toggleTopic, topics }}
      />
    </div>
  );
}

/**
 * The chat's own menu, beside its title: the inbox row's menu in the same
 * groups and order (see `chatMenuGroups`), with renaming it, which opens
 * the title's field, and its tasks among the ways to organize it, and
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
}) {
  const groups = chatMenuGroups(useChatActions(chat));
  const item = (action: RowAction) => (
    <DropdownMenuItem key={action.id} onSelect={action.run}>
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
  // The menu hands focus back to its trigger as it closes, which would land
  // after the field took it and blur the rename shut.
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Chat actions"
          className={toolbarClassName({
            // 4px around a 16px glyph: the button hugs the title it acts on
            // rather than reading as its own toolbar slot.
            className:
              "size-6 shrink-0 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            pressed: false,
          })}
          size="icon-sm"
          variant="ghost"
        >
          <DotsThreeOutlineVerticalIcon className="size-4" weight="fill" />
        </Button>
      </DropdownMenuTrigger>
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
        {/* Only here, where one chat is all there is: a row in the inbox is
            one of many, and a press there should not be able to end one. */}
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <TrashIcon className="size-3.5" />
          Delete chat…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
