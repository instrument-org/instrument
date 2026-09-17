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
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode } from "react";

import { useThreadActions } from "./thread-actions";
import { TopicPill } from "./thread-row";
import { type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

/**
 * The head over a thread's conversation, the way a task's page heads its
 * chat: the topic it is filed under and its title at the left with the
 * thread's own menu hugging them, and at the right the controls over the
 * whole thread, the pane toggle while the pane is closed and the way out of
 * the thread. Nothing under it but air: the transcript starts below.
 */
export function ThreadHeader({
  onClose,
  onNewTopic,
  onSetTopics,
  thread,
  topics,
  trailing,
}: {
  /** Puts the thread away from the screen; the inbox takes its place. */
  onClose: () => void;
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread | undefined;
  topics: Topic[];
  /** What sits before the way out: the pane toggle while the pane is closed. */
  trailing?: ReactNode;
}) {
  const topic = topics.find((entry) => entry.id === thread?.topics[0]);
  return (
    <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
        {topic && <TopicPill topic={topic} />}
        <h2 className="min-w-0 truncate text-sm font-medium">
          {thread?.title ?? "Thread"}
        </h2>
        {thread && (
          <ThreadMenu
            onClose={onClose}
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            thread={thread}
            topics={topics}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-x-1">
        {trailing}
        <Button
          aria-label="Close thread"
          className={toolbarClassName({
            className: "shrink-0",
            pressed: false,
          })}
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The thread's own menu, beside its title: what the inbox row offers from
 * its edge and its menu (putting it away, marking it read, starring it),
 * its topics, and the way out.
 */
function ThreadMenu({
  onClose,
  onNewTopic,
  onSetTopics,
  thread,
  topics,
}: {
  onClose: () => void;
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const actions = useThreadActions(thread);
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
      <DropdownMenuContent align="start" className="w-56">
        {actions.map((action) => (
          <DropdownMenuItem key={action.id} onSelect={action.run}>
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onClose}>
          <XIcon className="size-4" />
          Close
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
