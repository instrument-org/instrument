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
import { toolbarClassName } from "@/client/components/ui/toggle";
import { cn } from "@/client/lib/utils";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { type ReactNode, useRef } from "react";

import { useThreadActions } from "./thread-actions";
import { TopicPill } from "./thread-row";
import { ThreadTitle } from "./thread-title";
import { type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";
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
  onNewTopic,
  onSetTopics,
  popOut,
  thread,
  topics,
  trailing,
}: {
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
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
  return (
    <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
        {thread ? (
          <h2 className="flex min-w-0">
            <ThreadTitle
              className="text-sm font-medium"
              rename={rename}
              title={thread.title}
            />
          </h2>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">Thread</h2>
        )}
        {/* After the title, the way mail puts a label after a subject. */}
        {filed.map((topic) => (
          <TopicPill key={topic.id} topic={topic} />
        ))}
        {thread && (
          <ThreadMenu
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            rename={rename}
            thread={thread}
            topics={topics}
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
 * its topics.
 */
function ThreadMenu({
  onNewTopic,
  onSetTopics,
  rename,
  thread,
  topics,
}: {
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
  rename: ThreadRename;
  thread: Thread;
  topics: Topic[];
}) {
  const actions = useThreadActions(thread);
  // The menu hands focus back to its trigger as it closes, which would land
  // after the field took it and blur the rename shut.
  const renaming = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Thread actions"
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
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            rename.start();
          }}
        >
          <PencilSimpleIcon className="size-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <TagIcon className="size-4" />
            Topics
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            {topics
              .filter((entry) => !entry.retired)
              .map((entry) => (
                <DropdownMenuCheckboxItem
                  checked={thread.topics.includes(entry.id)}
                  key={entry.id}
                  onSelect={() => {
                    onSetTopics(
                      thread.topics.includes(entry.id)
                        ? thread.topics.filter((id) => id !== entry.id)
                        : [...thread.topics, entry.id],
                    );
                  }}
                >
                  <TopicMark topic={entry} />
                  {entry.name}
                </DropdownMenuCheckboxItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onNewTopic}>
              <PlusIcon className="size-4" />
              New topic…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
