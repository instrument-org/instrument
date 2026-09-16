import { Favicon } from "@/client/components/favicon";
import { RelativeTime } from "@/client/components/relative-time";
import { SkillMentionText } from "@/client/components/skill-mention-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { HoldMarks } from "./hold-marks";
import { THREADS_HREF } from "./screen-presentation";
import { askOf, type Thread, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** How many site marks a working row shows beside its step. */
const SITES_SHOWN = 4;

/**
 * One thread in the chat, and the door into it: a plain click anywhere on it
 * opens the thread in place, a middle or modified click in a tab of its own,
 * a right click raises its menu, and the keyboard opens it with Enter. The
 * time of day it began in a gutter at the left, and the lines hanging off one
 * edge past it. The topics it is filed under as pills and the title in muted
 * regular weight, once the agent has given it one; the line is left out
 * until then, since the ask under it is the title until then. The ask
 * exactly as it was typed, clamped with a fade. The replies line: a dot
 * while there are replies not yet seen, how many in brand, when the last one
 * landed, a peek at what is inside (the step it is working through, the
 * question it is waiting on, or the last reply's first words), and what it
 * holds as marks at its end. No avatar, no name: every row here is the
 * user's. The pills, the marks, and the tag control at the first line's end
 * while the pointer is on the row are the row's own controls, and a click on
 * one stops short of the door.
 */
export function ThreadRow({
  appsBySlug,
  onNewTopic,
  onOpen,
  onSetTopics,
  thread,
  topics,
}: {
  appsBySlug: AppsBySlug;
  onNewTopic: () => void;
  /** A plain click: the thread in place of whatever the window shows. */
  onOpen: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const marks = thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
  const [isPicking, setPicking] = useState(false);
  // The gestures that ask for a place of the thread's own: a middle click, a
  // modified click, the menu on a right click. A plain click is the caller's.
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });
  const hasHeader = thread.titled || marks.length > 0;
  const tagControl = (
    <TagControl
      isOpen={isPicking}
      onNewTopic={onNewTopic}
      onOpenChange={setPicking}
      onSetTopics={onSetTopics}
      thread={thread}
      topics={topics}
    />
  );

  return (
    // A click target, not text: no selection and no text cursor over it. The
    // controls inside stop their clicks short of it.
    <div
      className="group/row relative flex cursor-default items-start gap-2 rounded-md px-2 py-2.5 select-none hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-hidden has-[[data-state=open]]:bg-foreground/4"
      onAuxClick={gestures.onAuxClick}
      onClick={(event) => {
        if (wantsNewTab(event)) {
          gestures.separate?.run();
          return;
        }
        onOpen();
      }}
      onContextMenu={gestures.onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* The gutter: the time of day alone, since the day head above carries
        the date, right-aligned so every row's time ends at the same edge and
        on the first line's height so the two read as one. */}
      <span className="w-14 shrink-0 text-right text-[11px] leading-5 text-muted-foreground tabular-nums">
        {format(thread.createdAt, "h:mm a")}
      </span>
      <div className="min-w-0 flex-1">
        {hasHeader && (
          <p className="flex h-5 items-center gap-1.5 px-1 text-[13px]">
            {tagControl}
            {marks.map((topic) => (
              <TopicPill
                key={topic.id}
                onPick={() => {
                  setPicking(true);
                }}
                topic={topic}
              />
            ))}
            {marks.length > 0 && thread.titled && (
              <span className="shrink-0 text-muted-foreground/60">·</span>
            )}
            {/* The title has what the pills and the control leave: it is
              what truncates first. */}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {thread.titled ? thread.title : ""}
            </span>
          </p>
        )}
        {/* With no header, the ask is the first line and the control opens
          it, where the pills would be. */}
        <div className={cn("flex items-start gap-1.5", hasHeader && "mt-0.5")}>
          {!hasHeader && tagControl}
          <Ask text={askOf(thread)} />
        </div>
        <RepliesLine appsBySlug={appsBySlug} thread={thread} />
      </div>
      <RowMenu thread={thread} />
    </div>
  );
}

/**
 * The row's own menu, at its top right while the pointer is on the row: the
 * one thing a thread offers that no line of it carries, which is putting it
 * back among the unread, or the reverse. A pick stops short of the door.
 */
function RowMenu({ thread }: { thread: Thread }) {
  const { taskId } = useOrchestrator();
  const seen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const unseen = useMutation(
    rpcClient.workspace.orchestrator.threads.unseen.mutationOptions(),
  );
  const canUnread = thread.unread === 0 && thread.replyCount > 0;
  const canRead = thread.unread > 0;
  if (!canUnread && !canRead) {
    return null;
  }
  return (
    <span
      className="absolute top-1.5 right-1.5 hidden group-hover/row:flex focus-within:flex has-[[data-state=open]]:flex"
      onAuxClick={stopHere}
      onClick={stopHere}
      onContextMenu={stopHere}
      onKeyDown={stopHere}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More"
            className="grid size-5 place-items-center rounded-md bg-background/90 text-muted-foreground shadow-xs ring-1 ring-border hover:text-foreground data-[state=open]:text-foreground"
            type="button"
          >
            <DotsThreeIcon className="size-4" weight="bold" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRead ? (
            <DropdownMenuItem
              onSelect={() => {
                seen.mutate({ id: taskId, sessionId: thread.id });
              }}
            >
              Mark as read
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => {
                unseen.mutate({ id: taskId, sessionId: thread.id });
              }}
            >
              Mark as unread
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** The ask exactly as typed, the way the transcript draws a sent message, clamped to two lines with a fade when it runs past them. */
function Ask({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isClamped, setClamped] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // `scrollHeight` is the full height under the clamp, so the answer holds
    // however the pane is resized.
    const check = () => {
      setClamped(element.scrollHeight > element.clientHeight + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [text]);
  return (
    // A mask rather than a painted fade, so the words thin out over whatever
    // the row is drawn on.
    <div
      className={cn(
        "line-clamp-2 min-w-0 flex-1 px-1 text-sm break-words whitespace-pre-wrap",
        isClamped && "mask-b-from-55%",
      )}
      ref={ref}
    >
      <SkillMentionText text={text} />
    </div>
  );
}

/**
 * A peek at what is inside the thread, on the replies line after its count
 * and time and taking what is left of it: the step while it works, the
 * question while it waits, and the last reply's first words otherwise.
 * Nothing when an idle thread has said nothing yet.
 */
function Peek({ thread }: { thread: Thread }) {
  const isWaiting = thread.state === "waiting";
  const isWorking = thread.state === "working";
  if (!thread.latest && !isWaiting && !isWorking) {
    return null;
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {isWorking ? (
        <>
          {/* `brand-shiny-text` is an inline-block, which a parent's truncate
            cannot shrink, so the step carries its own. */}
          <span className="brand-shiny-text min-w-0 truncate">
            {thread.runningTasks.find((task) => task.step)?.step ??
              thread.latest?.text ??
              "Working"}
          </span>
          {thread.holds.sites.slice(0, SITES_SHOWN).map((site) => (
            <Favicon
              className="size-3.5 shrink-0"
              key={site}
              url={`https://${site}`}
            />
          ))}
        </>
      ) : isWaiting ? (
        <>
          <QuestionIcon
            className="size-3.5 shrink-0 text-warning-700 dark:text-warning-300"
            weight="bold"
          />
          <span className="min-w-0 truncate text-foreground/80">
            {thread.latest?.text || "Waiting on you"}
          </span>
        </>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">
          {thread.latest?.text}
        </span>
      )}
    </span>
  );
}

/**
 * The line under the ask that a chat gives a thread: a dot while there are
 * replies not yet seen, how many replies in brand so the count is what the
 * eye lands on, when the last one landed in a lighter gray beside it, the
 * peek at what is inside truncating to what the line has left, then the
 * marks of what the thread holds. Only what exists is said: no count before
 * the first reply, and no line at all for an idle thread with nothing to
 * say. Nothing on it moves when the row is hovered.
 */
function RepliesLine({
  appsBySlug,
  thread,
}: {
  appsBySlug: AppsBySlug;
  thread: Thread;
}) {
  const { lastReplyAt, replyCount, unread } = thread;
  const hasPeek =
    thread.latest !== undefined ||
    thread.state === "waiting" ||
    thread.state === "working";
  const hasHolds =
    thread.holds.apps.length > 0 ||
    thread.holds.files.length > 0 ||
    thread.holds.sites.length > 0;
  if (replyCount === 0 && !hasPeek && !hasHolds) {
    return null;
  }
  return (
    <div className="mt-0.5 flex h-6 items-center gap-2 px-1 text-[12px]">
      {/* Not while the thread works: the step's own light is the news then,
        and a dot coming and going beside it read as flicker. */}
      {unread > 0 && thread.state !== "working" && (
        <span
          aria-label="Unread"
          className="-mr-1 size-1.5 shrink-0 rounded-full bg-brand-500"
        />
      )}
      {/* Green only while there is something unseen, with the dot: a count
        that has been read is still the line's landmark, in the text's own
        color. */}
      {replyCount > 0 && (
        <span
          className={cn(
            "shrink-0 font-medium",
            unread > 0 && thread.state !== "working"
              ? "text-brand-600 dark:text-brand-400"
              : "text-muted-foreground",
          )}
        >
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </span>
      )}
      {replyCount > 0 && lastReplyAt !== undefined && (
        <ReplyTime at={lastReplyAt} />
      )}
      <Peek thread={thread} />
      {hasHolds && (
        <HoldMarks
          appsBySlug={appsBySlug}
          className="ml-auto"
          holds={thread.holds}
        />
      )}
    </div>
  );
}

/**
 * How long ago the last reply landed, with the clock in its tooltip. Relative
 * whatever the day, since a clock beside the count read as a second start
 * time; it moves once a minute, which is below notice.
 */
function ReplyTime({ at }: { at: number }) {
  return (
    <RelativeTime
      className="shrink-0 text-muted-foreground/70"
      compact
      date={new Date(at)}
    />
  );
}

/** Keeps a control's gesture from reaching the row under it, which would open the thread. */
function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The control that files the thread, at the first line's start where the
 * pills sit, and in the flow only while the pointer is on the row or its list
 * is open: it takes its room then and gives it back after, with no motion, so
 * the pills beside it read as the things it adds to. The list is the one a
 * pill opens too: the row keeps its open state so either way in lands here.
 */
function TagControl({
  isOpen,
  onNewTopic,
  onOpenChange,
  onSetTopics,
  thread,
  topics,
}: {
  isOpen: boolean;
  onNewTopic: () => void;
  onOpenChange: (open: boolean) => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  return (
    // The list is drawn elsewhere on the page but is this span's in React's
    // eyes, so a pick inside it stops here rather than opening the thread.
    <span
      className="hidden shrink-0 group-hover/row:flex focus-within:flex has-[[data-state=open]]:flex"
      onAuxClick={stopHere}
      onClick={stopHere}
      onContextMenu={stopHere}
    >
      <Popover onOpenChange={onOpenChange} open={isOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label="Topics"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:text-foreground"
            title="Topics"
            type="button"
          >
            <TagIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-60 p-1"
          role="menu"
          side="bottom"
          sideOffset={4}
        >
          <TopicPickList
            chosen={new Set(thread.topics)}
            onNew={() => {
              onOpenChange(false);
              onNewTopic();
            }}
            onToggle={(id) => {
              onSetTopics(
                thread.topics.includes(id)
                  ? thread.topics.filter((entry) => entry !== id)
                  : [...thread.topics, id],
              );
            }}
            topics={topics}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * A topic the thread is filed under, as a pill in its tint no taller than the
 * line it sits on: its emoji, or its mark's tile where it has none, then its
 * name. Clicking it opens the thread's topic list rather than the thread.
 */
function TopicPill({ onPick, topic }: { onPick: () => void; topic: Topic }) {
  return (
    <button
      // `leading-4` rather than none: the name's box has to hold its
      // descenders, or the clip that truncates it cuts them off.
      className="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) pr-1.5 pl-1 text-[11px] leading-4 text-foreground/90 topic-tint hover:bg-(--topic-tint-edge) hover:text-foreground"
      onAuxClick={stopHere}
      onClick={(event) => {
        stopHere(event);
        onPick();
      }}
      onContextMenu={stopHere}
      style={topicTint(topicColor(topic))}
      title="Topics"
      type="button"
    >
      {topic.emoji ? (
        <span className="text-[10px]">{topic.emoji}</span>
      ) : (
        <TopicMark className="size-3.5 text-[10px]" topic={topic} />
      )}
      <span className="truncate">{topic.name}</span>
    </button>
  );
}

/**
 * Whether a click asks for a tab of its own. One modifier, the one the
 * platform means it by: on macOS Ctrl and a click is the secondary click, so
 * answering it with a tab would take the gesture away from the menu.
 */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
