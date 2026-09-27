import { RevealInFolderIcon } from "@/client/components/icons/reveal-in-folder";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { cn, getRevealInFolderLabel } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TrashIcon } from "@phosphor-icons/react/Trash";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";

import { DeleteChatDialog } from "./delete-chat-dialog";
import { useThreadActions } from "./thread-actions";
import { TopicPill } from "./thread-row";
import { ThreadTitle } from "./thread-title";
import { type Thread, type Topic } from "./threads";
import { TopicPicker } from "./topic-picker";
import { type ThreadRename, useThreadRename } from "./use-thread-rename";

/**
 * The head over a thread's conversation, the way a task's page heads its
 * chat: its title at the left, which renames the thread when clicked, the
 * topics it is filed under after it, and the thread's own menu hugging them,
 * and at the right the glyph that pops the conversation out into its small
 * view in the corner (lit while it is out, when pressing it brings the
 * conversation back), then the pane toggle while the pane is closed. No way out of the thread here: the
 * thread stays beside the inbox until the inbox is dragged over it. Nothing
 * under the head but air: the transcript starts below.
 */
export function ThreadHeader({
  leading,
  onDeleted,
  onNewTopic,
  onSetTopics,
  onViewTasks,
  popOut,
  thread,
  topics,
  trailing,
}: {
  /** What sits ahead of the title: the toggle that puts the inbox away. */
  leading?: ReactNode;
  /** Told once the thread has been deleted, so the window can put it away. */
  onDeleted: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  onSetTopics: (topics: string[]) => void;
  /** Opens the chat's tasks as the pane's face, when the head can reach them. */
  onViewTasks?: () => void;
  /** Whether the conversation is in its small view, and the press that sends it there or brings it back. */
  popOut?: { isOut: boolean; onToggle: () => void };
  thread: Thread | undefined;
  topics: Topic[];
  /** What sits at the head's right: the pane toggle while the pane is closed. */
  trailing?: ReactNode;
}) {
  // Every topic the thread is filed under, in the order it was filed.
  const filed = (thread?.topics ?? []).flatMap((id) => {
    const topic = topics.find((entry) => entry.id === id);
    return topic ? [topic] : [];
  });
  const rename = useThreadRename(thread);
  const [isDeleting, setDeleting] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  return (
    <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
      {thread && (
        <DeleteChatDialog
          onDeleted={onDeleted}
          onOpenChange={setDeleting}
          open={isDeleting}
          thread={thread}
        />
      )}
      <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
        {leading}
        {thread ? (
          <h2 className="flex min-w-0">
            <ThreadTitle
              className="text-sm font-medium"
              rename={rename}
              title={thread.title}
            />
          </h2>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">Chat</h2>
        )}
        {/* After the title, the way mail puts a label after a subject;
            pressing them, or the slot while there are none, opens the topic
            picker every filing shares. */}
        {thread && (
          <TopicPicker
            chosen={new Set(thread.topics)}
            isOpen={topicsOpen}
            onNew={onNewTopic}
            onOpenChange={setTopicsOpen}
            onToggle={(id) => {
              onSetTopics(
                thread.topics.includes(id)
                  ? thread.topics.filter((entry) => entry !== id)
                  : [...thread.topics, id],
              );
            }}
            topics={topics}
          >
            {filed.length === 0 ? (
              // No dashed slot in the head: a chat with no topics is filed
              // from the menu, and this is only the picker's anchor then.
              <span aria-hidden className="h-4 w-0 shrink-0" />
            ) : (
              <button
                aria-label="Topics"
                className="flex min-w-0 items-center gap-1"
                type="button"
              >
                {filed.map((topic) => (
                  <TopicPill key={topic.id} topic={topic} />
                ))}
              </button>
            )}
          </TopicPicker>
        )}
        {thread && (
          <ThreadMenu
            onDelete={() => {
              setDeleting(true);
            }}
            onEditTopics={() => {
              setTopicsOpen(true);
            }}
            onViewTasks={onViewTasks}
            rename={rename}
            thread={thread}
          />
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
 * The thread's own menu, beside its title: what the inbox row offers from
 * its edge and its menu (putting it away, marking it read, starring it,
 * saving its transcript), renaming it, which opens the title's field, and
 * deleting it. Its topics are the pills beside the title.
 */
export function ThreadMenu({
  onDelete,
  onEditTopics,
  onViewTasks,
  rename,
  thread,
}: {
  onDelete: () => void;
  /** Opens the topic picker, when the head that owns the menu has one. */
  onEditTopics?: () => void;
  /** Opens the chat's tasks, when the head can reach them. */
  onViewTasks?: () => void;
  rename: ThreadRename;
  thread: Thread;
}) {
  const actions = useThreadActions(thread);
  const reveal = useMutation(
    rpcClient.utils.openTaskIn.mutationOptions({
      onError: (error) => {
        toast.error("Failed to open the chat's folder", {
          description: error.message,
        });
      },
    }),
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
              "size-6 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
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
        {actions.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.run}>
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
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
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            rename.start();
          }}
        >
          <PencilSimpleIcon className="size-3.5" />
          Rename
        </DropdownMenuItem>
        {onEditTopics && (
          <DropdownMenuItem
            onSelect={() => {
              onEditTopics();
            }}
          >
            <TagIcon className="size-3.5" />
            Topics
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            reveal.mutate({ id: thread.chatId, type: "show-in-folder" });
          }}
        >
          <RevealInFolderIcon className="size-4" />
          {getRevealInFolderLabel()}
        </DropdownMenuItem>
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
