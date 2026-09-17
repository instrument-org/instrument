import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { useMutation } from "@tanstack/react-query";
import { type SyntheticEvent, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { useOrchestrator } from "./context";
import { HoldMarks } from "./hold-marks";
import { THREADS_HREF } from "./screen-presentation";
import { activityLabel, type Thread, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** The two shapes a row takes, by the room the list has: one line across a wide list, three down a narrow one. */
export type RowDensity = "slim" | "tall";

/**
 * One thread in the inbox, and the door into it: a plain click anywhere on it
 * opens the thread in place, a middle or modified click in a tab of its own,
 * a right click raises its menu, and the keyboard opens it with Enter. Its
 * state as a dot in a gutter at the left: brand while it works or holds
 * replies not yet seen, amber while it waits on the user, nothing while it is
 * quiet. Then the topic it is filed under as a pill, the title in semibold
 * while there is something unseen in it, the agent's latest line (the step it
 * is on, the question it is waiting on, or its last reply's first words), the
 * marks of what it holds, and when anything last happened at the far right.
 * Slim, all of that is one line, the way a mailbox lists mail; tall, the
 * title has the first line with the reply count right after it and the time
 * at its end, the latest line gets two, and the files it made sit on a third
 * as chips with their names, the apps and sites as marks beside them. No
 * avatar, no name: every row
 * here is the user's. The pill, the marks, and the tag control that stands
 * in front of the pill while the pointer is on the row are the row's own
 * controls, and a click on one stops short of the door.
 */
export function ThreadRow({
  appsBySlug,
  density,
  now,
  onNewTopic,
  onOpen,
  onSetTopics,
  thread,
  topics,
}: {
  appsBySlug: AppsBySlug;
  density: RowDensity;
  /** The moment the time at the row's end is read against. */
  now: Date;
  onNewTopic: () => void;
  /** A plain click: the thread in place of whatever the window shows. */
  onOpen: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const topic = topics.find((entry) => entry.id === thread.topics[0]);
  const [isPicking, setPicking] = useState(false);
  // The gestures that ask for a place of the thread's own: a middle click, a
  // modified click, the menu on a right click. A plain click is the caller's.
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });
  const isUnseen = thread.unread > 0;
  const hasHolds =
    thread.holds.apps.length > 0 ||
    thread.holds.files.length > 0 ||
    thread.holds.sites.length > 0;
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
  const pill = topic && (
    <TopicPill
      onPick={() => {
        setPicking(true);
      }}
      topic={topic}
    />
  );
  const title = (
    <span
      className={cn(
        "min-w-0 truncate text-[13px]",
        density === "slim" && "flex-1",
        isUnseen ? "font-semibold" : "text-foreground/90",
      )}
    >
      {thread.title}
    </span>
  );
  const time = (
    <span
      className={cn(
        "shrink-0 text-right text-[11px] tabular-nums",
        isUnseen ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {activityLabel(new Date(thread.updatedAt), now)}
    </span>
  );

  return (
    // A click target, not text: no selection and no text cursor over it. The
    // controls inside stop their clicks short of it.
    <div
      className={cn(
        "group/row relative flex cursor-default gap-2 px-2 select-none hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-hidden has-[[data-state=open]]:bg-foreground/4",
        density === "slim" ? "h-9 items-center" : "items-start py-2.5",
      )}
      data-density={density}
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
      {/* The gutter: the state alone, on the first line's height so the dot
        sits beside the title whatever the row's shape. */}
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        <StateDot thread={thread} />
      </span>
      {density === "slim" ? (
        <>
          {/* The title's column is fixed, so every row's latest line starts
            at one edge and the column reads down as a list of names. */}
          <span className="flex min-w-0 basis-[38%] items-center gap-1.5">
            {tagControl}
            {pill}
            {title}
          </span>
          <Peek className="min-w-0 flex-1" lines={1} thread={thread} />
          {hasHolds && (
            <HoldMarks
              appsBySlug={appsBySlug}
              className="ml-auto"
              holds={thread.holds}
              namedFiles
            />
          )}
          <span className="w-14 shrink-0 text-right">{time}</span>
        </>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="flex h-5 items-center gap-1.5">
            {tagControl}
            {pill}
            {/* The count right after the title, the way a mailbox counts a
              conversation beside its sender, and only once there is a
              conversation to count. */}
            <span className="flex min-w-0 flex-1 items-center gap-1">
              {title}
              {thread.replyCount > 1 && (
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {thread.replyCount}
                </span>
              )}
            </span>
            {time}
          </p>
          <Peek className="mt-0.5" lines={2} thread={thread} />
          {hasHolds && (
            <HoldMarks
              appsBySlug={appsBySlug}
              className="mt-1 flex-wrap gap-1"
              holds={thread.holds}
              namedFiles
            />
          )}
        </div>
      )}
      <RowMenu density={density} thread={thread} />
    </div>
  );
}

/**
 * The agent's latest line: the step while it works, in brand; the question
 * while it waits, behind an amber glyph with the words themselves in gray;
 * and the last reply's first words otherwise, in muted. Nothing when an idle
 * thread has said nothing yet. One line that truncates, or two that clamp.
 */
function Peek({
  className,
  lines,
  thread,
}: {
  className?: string;
  lines: 1 | 2;
  thread: Thread;
}) {
  const isWaiting = thread.state === "waiting";
  const isWorking = thread.state === "working";
  if (!thread.latest && !isWaiting && !isWorking) {
    return null;
  }
  const clamp = lines === 1 ? "truncate" : "line-clamp-2";
  return (
    <span
      className={cn(
        "flex items-start gap-1.5 text-[12px] leading-5",
        className,
      )}
    >
      {isWorking ? (
        // `brand-shiny-text` is an inline-block, which a parent's truncate
        // cannot shrink, so the step carries its own clamp.
        <span className={cn("brand-shiny-text min-w-0", clamp)}>
          {thread.runningTasks.find((task) => task.step)?.step ??
            thread.latest?.text ??
            "Working"}
        </span>
      ) : isWaiting ? (
        <>
          <QuestionIcon
            className="mt-[3px] size-3.5 shrink-0 text-warning-700 dark:text-warning-300"
            weight="bold"
          />
          <span className={cn("min-w-0 text-foreground/80", clamp)}>
            {thread.latest?.text || "Waiting on you"}
          </span>
        </>
      ) : (
        <span className={cn("min-w-0 text-muted-foreground", clamp)}>
          {thread.latest?.text}
        </span>
      )}
    </span>
  );
}

/**
 * The row's own menu, at its right edge while the pointer is on the row: the
 * one thing a thread offers that no line of it carries, which is putting it
 * back among the unread, or the reverse. A pick stops short of the door.
 */
function RowMenu({ density, thread }: { density: RowDensity; thread: Thread }) {
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
      className={cn(
        "absolute right-1.5 hidden group-hover/row:flex focus-within:flex has-[[data-state=open]]:flex",
        density === "slim" ? "top-1/2 -translate-y-1/2" : "top-1.5",
      )}
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

/**
 * Where the thread stands, as a dot: amber while it waits on the user, brand
 * while it works or holds replies not yet seen, and nothing at all while it
 * is quiet, so the gutter is empty down a list with nothing new in it.
 */
function StateDot({ thread }: { thread: Thread }) {
  if (thread.state === "waiting") {
    return (
      <span
        aria-label="Needs you"
        className="size-2 rounded-full bg-warning-500"
      />
    );
  }
  if (thread.state === "working" || thread.unread > 0) {
    return (
      <span
        aria-label={thread.state === "working" ? "Working" : "Unread"}
        className="size-2 rounded-full bg-brand-500"
      />
    );
  }
  return null;
}

/** Keeps a control's gesture from reaching the row under it, which would open the thread. */
function stopHere(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The control that files the thread, in front of the pill and in the flow
 * only while the pointer is on the row or its list is open: it takes its
 * room then and gives it back after, with no motion, so the pill beside it
 * reads as the thing it adds to. The list is the one the pill opens too: the
 * row keeps its open state so either way in lands here.
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
 * The topic the thread is filed under, as a pill in its tint no taller than
 * the line it sits on: its emoji, or its mark's tile where it has none, then
 * its name. Clicking it opens the thread's topic list rather than the thread.
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
