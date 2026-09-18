import { useTranscriptActions } from "@/client/components/task/transcript-actions";
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
import { rpcClient } from "@/client/rpc/client";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { DotsThreeOutlineVerticalIcon } from "@phosphor-icons/react/DotsThreeOutlineVertical";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { TextAaIcon } from "@phosphor-icons/react/TextAa";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";
import { useThreadActions } from "./thread-actions";
import { TopicPill } from "./thread-row";
import { type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

/**
 * The head over a thread's conversation, the way a task's page heads its
 * chat: the topic it is filed under and its title at the left with the
 * thread's own menu hugging them, and at the right the pane toggle while
 * the pane is closed. No way out of the thread here: the thread stays
 * beside the inbox until the inbox is dragged over it. Nothing under the
 * head but air: the transcript starts below.
 */
export function ThreadHeader({
  onNewTopic,
  onSetTopics,
  thread,
  topics,
  trailing,
}: {
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
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
  return (
    <div className="flex w-full min-w-0 shrink-0 items-center gap-x-2 bg-background p-3">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-x-2 select-none">
        {filed.map((topic) => (
          <TopicPill key={topic.id} topic={topic} />
        ))}
        <h2 className="min-w-0 truncate text-sm font-medium">
          {thread?.title ?? "Thread"}
        </h2>
        {thread && (
          <ThreadMenu
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            thread={thread}
            topics={topics}
          />
        )}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-x-1">{trailing}</div>
      )}
    </div>
  );
}

/**
 * The thread's own menu, beside its title: what the inbox row offers from
 * its edge and its menu (putting it away, marking it read, starring it),
 * naming it again from where it stands, saving its transcript, and its
 * topics.
 */
function ThreadMenu({
  onNewTopic,
  onSetTopics,
  thread,
  topics,
}: {
  onNewTopic: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const { taskId } = useOrchestrator();
  const actions = useThreadActions(thread);
  // The same call that names a thread after each finished turn, on the
  // user's ask: the conversation moves on, and its name follows when asked.
  const retitle = useMutation(
    rpcClient.workspace.orchestrator.threads.retitle.mutationOptions({
      onError: (error) => {
        toast.error("Failed to rename the thread", {
          description: error.message,
        });
      },
      onSuccess: ({ title }) => {
        if (title === undefined) {
          toast("Nothing to name it from yet");
        } else if (title === thread.title) {
          toast("The name still fits");
        } else {
          toast(`Renamed to “${title}”`);
        }
      },
    }),
  );
  const transcript = useTranscriptActions({
    id: taskId,
    label: thread.title,
    sessionId: thread.id,
  });
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
        <DropdownMenuItem
          disabled={retitle.isPending}
          onSelect={() => {
            retitle.mutate({ id: taskId, sessionId: thread.id });
          }}
        >
          <TextAaIcon className="size-4" />
          Rename from the conversation
        </DropdownMenuItem>
        {/* Saves without opening anything: the transcript lands in
          Downloads, named for the thread, and its path on the clipboard. */}
        <DropdownMenuItem
          onSelect={() => {
            transcript.save("markdown");
          }}
        >
          <ArrowLineDownIcon className="size-4" />
          Save transcript
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
