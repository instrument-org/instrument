import { Favicon } from "@/client/components/favicon";
import { RelativeTime } from "@/client/components/relative-time";
import { SkillMentionText } from "@/client/components/skill-mention-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { format } from "date-fns";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { HoldsStrip } from "./holds-strip";
import { THREADS_HREF } from "./screen-presentation";
import { askOf, type Thread, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** How many site marks a working row shows beside its step. */
const SITES_SHOWN = 4;

/** The three gestures a door into the thread answers: a plain click, a middle or modified click, a right click. */
interface Door {
  onAuxClick: (event: MouseEvent) => void;
  onClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
}

/**
 * One thread in the chat: the time of day it began in a gutter at the left,
 * and four lines hanging off one edge past it. The topics it is filed under
 * as pills, a dot, and the title in muted regular weight, with the tag control
 * at the line's end while the pointer is on the row. The ask exactly as it
 * was typed, clamped with a fade. The replies row: how many in brand, how many
 * of them unseen, when the last one landed, then a peek at what is inside
 * (the step it is working through, the question it is waiting on, or the last
 * reply's first words), the whole line the door and saying so on hover. And
 * what it holds. No avatar, no name: every row here is the user's. The ask
 * and the replies row each open the thread the same way; a pill narrows the
 * list to its topic; the padding between them opens nothing.
 */
export function ThreadRow({
  appsBySlug,
  onNewTopic,
  onOpen,
  onPickTopic,
  onSetTopics,
  thread,
  topics,
}: {
  appsBySlug: AppsBySlug;
  onNewTopic: () => void;
  /** A plain click: the thread in place of whatever the window shows. */
  onOpen: () => void;
  /** A pill: the list narrowed to that topic. */
  onPickTopic: (topicId: string) => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const hasHolds =
    thread.holds.apps.length > 0 ||
    thread.holds.files.length > 0 ||
    thread.holds.sites.length > 0;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const marks = thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
  // The gestures that ask for a place of the thread's own: a middle click, a
  // modified click, the menu on a right click. A plain click is the caller's.
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });
  const door: Door = {
    onAuxClick: gestures.onAuxClick,
    onClick: (event) => {
      if (wantsNewTab(event)) {
        gestures.separate?.run();
        return;
      }
      onOpen();
    },
    onContextMenu: gestures.onContextMenu,
  };

  return (
    // Not text: no selection and no text cursor over it. Each line brings its
    // own click target, or none.
    <div className="group/row flex cursor-default items-start gap-2 px-2 py-3 select-none">
      {/* The gutter: the time of day alone, since the day head above carries
        the date, right-aligned so every row's time ends at the same edge and
        on the header's line so the two read as one. */}
      <span className="w-14 shrink-0 text-right text-[11px] leading-5 text-muted-foreground tabular-nums">
        {format(thread.createdAt, "h:mm a")}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex h-5 items-center gap-1.5 px-1 text-[13px]">
          {marks.map((topic) => (
            <TopicPill
              key={topic.id}
              onPick={() => {
                onPickTopic(topic.id);
              }}
              topic={topic}
            />
          ))}
          {marks.length > 0 && (
            <span className="shrink-0 text-muted-foreground/60">·</span>
          )}
          {/* The title has what the pills and the control leave: it is what
            truncates first. */}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {thread.title}
          </span>
          <TagControl
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            thread={thread}
            topics={topics}
          />
        </p>
        <Ask door={door} text={askOf(thread)} />
        <RepliesRow door={door} thread={thread} />
        {hasHolds && (
          <HoldsStrip
            appsBySlug={appsBySlug}
            className="mt-2 px-1"
            holds={thread.holds}
            size="sm"
          />
        )}
      </div>
    </div>
  );
}

/** The ask exactly as typed, the way the transcript draws a sent message, clamped to two lines with a fade when it runs past them. */
function Ask({ door, text }: { door: Door; text: string }) {
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
        "mt-1 line-clamp-2 px-1 text-sm break-words whitespace-pre-wrap",
        isClamped && "mask-b-from-55%",
      )}
      ref={ref}
      {...door}
    >
      <SkillMentionText text={text} />
    </div>
  );
}

/**
 * A peek at what is inside the thread, on the replies row after its count and
 * time and taking what is left of the line: the step while it works, the
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
 * The line under the ask that a chat gives a thread: how many replies, in
 * brand so the count is what the eye lands on, how many of them unseen, when
 * the last one landed in a lighter gray beside it, then the peek at what is
 * inside, truncating to what the line has left. The whole line is the door,
 * and on hover or focus says so at its far end.
 */
function RepliesRow({ door, thread }: { door: Door; thread: Thread }) {
  const { lastReplyAt, replyCount, unread } = thread;
  return (
    <button
      className="group/replies mt-1.5 flex h-6 w-full items-center gap-2 rounded-md px-1 text-[12px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden"
      type="button"
      {...door}
    >
      {replyCount === 0 ? (
        <span className="shrink-0 text-muted-foreground">No replies yet</span>
      ) : (
        <span className="shrink-0 font-medium text-brand-700 dark:text-brand-300">
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
          {unread > 0 && <span className="font-semibold">, {unread} new</span>}
        </span>
      )}
      {lastReplyAt !== undefined && (
        <RelativeTime
          className="shrink-0 text-muted-foreground/70"
          compact
          date={new Date(lastReplyAt)}
        />
      )}
      <Peek thread={thread} />
      <span className="ml-auto hidden shrink-0 font-medium text-foreground group-hover/replies:inline group-focus-visible/replies:inline">
        View thread
      </span>
    </button>
  );
}

/**
 * The control that files the thread, at the header's edge beside the time,
 * drawn only while the pointer is on the row or its list is open. Its list is
 * the one the Topics chip opens.
 */
function TagControl({
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
  const [isOpen, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Topics"
          className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 data-[state=open]:text-foreground data-[state=open]:opacity-100"
          title="Topics"
          type="button"
        >
          <TagIcon className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 p-1"
        role="menu"
        side="bottom"
        sideOffset={4}
      >
        <TopicPickList
          chosen={new Set(thread.topics)}
          onNew={() => {
            setOpen(false);
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
  );
}

/**
 * A topic the thread is filed under, as a pill in its tint no taller than the
 * line it sits on: its face, then its name. The mark's tile is the pill's own
 * color, so what shows of it is the emoji, or the letter that stands in for
 * one. Clicking it narrows the list to the topic.
 */
function TopicPill({ onPick, topic }: { onPick: () => void; topic: Topic }) {
  return (
    <button
      className="inline-flex h-4.5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) py-0 pr-1.5 pl-1 text-[11px] leading-none text-foreground/90 topic-tint hover:ring-1 hover:ring-(--topic-tint-edge)"
      onClick={onPick}
      style={topicTint(topicColor(topic))}
      title={`Only ${topic.name}`}
      type="button"
    >
      <TopicMark className="size-3.5 text-[10px]" topic={topic} />
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
