import { promptDraftAtom } from "@/client/atoms/prompt-value";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StarIcon } from "@phosphor-icons/react/Star";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { OrchestratorContext, useOrchestrator } from "./context";
import { HoldMarks } from "./hold-marks";
import { RowActionBar } from "./row-action-bar";
import {
  type RowAction,
  rowClassName,
  type RowDensity,
  stopHere,
} from "./row-shell";
import { type Thread, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

/** How long the corner's bar stays after the topic list closes: the list's exit animation. */
const PICKER_LEAVE_MS = 250;

/**
 * One thread in the inbox, and the door into it: a click anywhere on it
 * opens the thread beside the list (a thread is never a tab, so no gesture
 * asks for one), a right click raises its menu, and the keyboard opens it
 * with Enter. Its
 * state as a dot in front of the title: brand while it works or holds
 * replies not yet seen, amber while it waits on the user, nothing while it is
 * quiet. Then the title in semibold while there is something unseen in it,
 * the word Draft after it in red while a reply sits typed and unsent in the
 * thread's composer, the way mail marks a thread with a draft in it,
 * the topics it is filed under as pills in the row's corner, the agent's
 * latest line (the step it is on, the question it is waiting on, or its last
 * reply's first words), and the marks of what it holds. No time on the row.
 * Slim, all of that is one line, the way a mailbox lists mail, with the
 * holds held to a share of it; tall, the title has the first line with the
 * topics at its end, the latest line gets two, and what it holds sits on a
 * third line that never wraps: the files it made as chips with their names,
 * the apps and sites as marks beside them, fading out at the row's edge,
 * with the star at that line's end in the row's bottom corner. No avatar,
 * no name: every row here is the user's. The marks, the star, the tag
 * control that stands in front of the title while the pointer is on the
 * row, and the actions that stand over the corner then (putting the thread
 * away or back, marking it read or unread) are the row's own controls, and a
 * click on one stops short of the door. The menu offers the same, with the
 * way to open the thread and its topics.
 */
export function ThreadRow({
  actions,
  appsBySlug,
  density,
  isOpen,
  onNewTopic,
  onOpen,
  onSetTopics,
  thread,
  topics,
}: {
  /** The thread's actions, answered by the list for every row through one set of mutations. */
  actions: RowAction[];
  appsBySlug: AppsBySlug;
  density: RowDensity;
  /** Whether this thread is the one open beside the list. */
  isOpen: boolean;
  onNewTopic: () => void;
  /** A plain click: the thread in place of whatever the window shows. */
  onOpen: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  // Every topic the thread is filed under, in the order it was filed.
  const filed = thread.topics.flatMap((id) => {
    const topic = topics.find((entry) => entry.id === id);
    return topic ? [topic] : [];
  });
  const [isPicking, setPicking] = useState(false);
  // Held in the flow for a moment after the list closes: the list animates
  // out anchored to the control, and a control that vanished with the
  // pointer already gone left the list to fly to the window's corner.
  const [isPickerLeaving, setPickerLeaving] = useState(false);
  const pickTopics = (open: boolean) => {
    setPicking(open);
    if (!open) {
      setPickerLeaving(true);
      setTimeout(() => {
        setPickerLeaving(false);
      }, PICKER_LEAVE_MS);
    }
  };
  const isUnseen = thread.unread > 0;
  // What the thread's composer holds, whether or not it is on screen.
  const draft = useAtomValue(
    promptDraftAtom({ scope: "thread", sessionId: thread.id }),
  );
  const hasDraft = draft.trim() !== "";
  const hasHolds =
    thread.holds.apps.length > 0 ||
    thread.holds.files.length > 0 ||
    thread.holds.sites.length > 0;
  const toggleTopic = (id: string) => {
    onSetTopics(
      thread.topics.includes(id)
        ? thread.topics.filter((entry) => entry !== id)
        : [...thread.topics, id],
    );
  };
  const tagControl = (
    <TagControl
      isOpen={isPicking}
      onNewTopic={onNewTopic}
      onOpenChange={pickTopics}
      onToggle={toggleTopic}
      thread={thread}
      topics={topics}
    />
  );
  // The topics in the row's corner, each by name; filing is the control in
  // the corner's bar.
  const pills = filed.map((topic) => (
    <TopicPill key={topic.id} topic={topic} />
  ));
  // The title takes only its own width, so the draft's word stands right
  // after it and keeps its place as the title truncates before it.
  const title = (
    <>
      <span
        className={cn(
          "min-w-0 truncate text-[13px]",
          isUnseen ? "font-semibold" : "text-foreground/90",
        )}
      >
        {thread.title}
      </span>
      {hasDraft && (
        <span className="shrink-0 text-[13px] text-error-700 dark:text-error-300">
          Draft
        </span>
      )}
    </>
  );
  return (
    // Not modal: a modal menu takes the pointer from the whole page while it
    // is up, so the click that put it away was eaten, and a reader who
    // right-clicked one row and then clicked another had asked for the second
    // and got nothing. The list is a list of doors; a click on one is a click
    // on one.
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div
          className={rowClassName(density, isOpen)}
          data-density={density}
          data-open={isOpen || undefined}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          {density === "slim" ? (
            <>
              {/* The title's column is fixed, so every row's latest line
                starts at one edge and the column reads down as a list of
                names. The state sits in front of the title as a dot. */}
              <span className="flex min-w-0 basis-[38%] items-center gap-1.5">
                <StateDot thread={thread} />
                {title}
              </span>
              <Peek className="min-w-0 flex-1" lines={1} thread={thread} />
              {/* No more than a share of the row, clipped with a fade past
                it, so a thread with many files never pushes into the title's
                column. */}
              {hasHolds && (
                <HoldsInThread threadId={thread.id}>
                  <HoldMarks
                    appsBySlug={appsBySlug}
                    className="ml-auto max-w-[30%]"
                    holds={thread.holds}
                    namedFiles
                    wrap={false}
                  />
                </HoldsInThread>
              )}
              {/* The topics at the row's end, stepping aside for the corner's
                bar while the pointer is on the row, then the star past them,
                in view, where mail keeps its star: a mark of the user's own,
                apart from the row's actions. */}
              <span className="flex shrink-0 items-center gap-1 group-hover/row:hidden">
                {pills}
              </span>
              <RowActionBar
                actions={actions}
                density={density}
                isHeld={isPickerLeaving}
                leading={tagControl}
              />
              <StarControl thread={thread} />
            </>
          ) : (
            <div className="min-w-0 flex-1">
              {/* The state as a dot in front of the title, and the topics
                at the line's end in the row's corner. */}
              <div className="flex h-5 items-center gap-1.5">
                <StateDot thread={thread} />
                {title}
                {/* Stepping aside for the corner's bar while the pointer is
                  on the row. */}
                <span className="ml-auto flex shrink-0 items-center gap-1 group-hover/row:invisible">
                  {pills}
                </span>
              </div>
              <Peek className="mt-0.5" lines={2} thread={thread} />
              {/* The holds and, at the line's end, the star in the row's
                bottom corner, where mail keeps it. */}
              <div className="mt-1 flex items-end gap-2">
                {hasHolds ? (
                  <HoldsInThread threadId={thread.id}>
                    <HoldMarks
                      appsBySlug={appsBySlug}
                      className="min-w-0 flex-1 gap-1"
                      holds={thread.holds}
                      namedFiles
                      wrap={false}
                    />
                  </HoldsInThread>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                <span className="-mr-1 -mb-0.5 shrink-0">
                  <StarControl thread={thread} />
                </span>
              </div>
            </div>
          )}
          {density === "tall" && (
            <RowActionBar
              actions={actions}
              density={density}
              isHeld={isPickerLeaving}
              leading={tagControl}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        <ContextMenuSeparator />
        {actions.map((action) => (
          <ContextMenuItem key={action.id} onSelect={action.run}>
            {action.icon}
            {action.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TagIcon className="size-4" />
            Topics
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 overflow-y-auto">
            {topics
              .filter((entry) => !entry.retired)
              .map((entry) => (
                <ContextMenuCheckboxItem
                  checked={thread.topics.includes(entry.id)}
                  key={entry.id}
                  onSelect={() => {
                    toggleTopic(entry.id);
                  }}
                >
                  <TopicMark topic={entry} />
                  {entry.name}
                </ContextMenuCheckboxItem>
              ))}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onNewTopic}>
              <PlusIcon className="size-4" />
              New topic…
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A topic the thread is filed under, as a pill in its tint no taller than
 * the line it sits on: its emoji, or its mark's tile where it has none, then
 * its name, or the mark alone when the pill is compact and the name is its
 * tooltip. Clicking it opens the thread's topic list rather than the thread;
 * given nothing to open, it is the name alone and no control.
 */
export function TopicPill({
  compact = false,
  onPick,
  topic,
}: {
  /** The mark alone, for a topic past the first on a row with a title to keep. */
  compact?: boolean;
  onPick?: () => void;
  topic: Topic;
}) {
  // `leading-4` rather than none: the name's box has to hold its descenders,
  // or the clip that truncates it cuts them off.
  const className = cn(
    "inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) pl-1 text-[11px] leading-4 text-foreground/90 topic-tint",
    compact ? "pr-1" : "pr-1.5",
  );
  const inside = (
    <>
      {topic.emoji ? (
        <span className="text-[10px]">{topic.emoji}</span>
      ) : (
        <TopicMark className="size-3.5 text-[10px]" topic={topic} />
      )}
      {!compact && <span className="truncate">{topic.name}</span>}
    </>
  );
  if (!onPick) {
    return (
      <span
        className={className}
        style={topicTint(topicColor(topic))}
        title={compact ? topic.name : undefined}
      >
        {inside}
      </span>
    );
  }
  return (
    <button
      className={cn(
        className,
        "hover:bg-(--topic-tint-edge) hover:text-foreground",
      )}
      onAuxClick={stopHere}
      onClick={(event) => {
        stopHere(event);
        onPick();
      }}
      style={topicTint(topicColor(topic))}
      title={compact ? topic.name : "Topics"}
      type="button"
    >
      {inside}
    </button>
  );
}

/**
 * Names the openers for the marks of what a thread holds: a hold is the
 * thread's, so opening one opens it as a tab of the thread's group, never
 * in place of whatever the right area had up, and brings the thread on
 * screen at that tab with its pane up. A middle or modified click asks for
 * the same tab.
 */
function HoldsInThread({
  children,
  threadId,
}: {
  children: ReactNode;
  threadId: StoreId.Session;
}) {
  const orchestrator = useOrchestrator();
  const options = { group: threadId, newTab: true, show: true };
  return (
    <OrchestratorContext
      value={{
        ...orchestrator,
        openPage: (url) => {
          orchestrator.openPage(url, options);
        },
        openScreen: (href) => {
          orchestrator.openScreen(href, options);
        },
        opensNewTab: true,
      }}
    >
      <FileOpenContext
        value={(path) => {
          orchestrator.openPath(path, options);
        }}
      >
        <PageOpenContext
          value={(url) => {
            orchestrator.openPage(url, options);
          }}
        >
          {children}
        </PageOpenContext>
      </FileOpenContext>
    </OrchestratorContext>
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
        // cannot shrink, so the step carries its own clamp. With no step to
        // name yet the line says that Instrument is at it, rather than
        // repeating the last thing said as if it were happening now.
        <span className={cn("brand-shiny-text min-w-0", clamp)}>
          {thread.runningTasks.find((task) => task.step)?.step ??
            "Instrument is working"}
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
 * The star as a control in the row: faint until the pointer is on the row
 * or the star is given, filled in amber once it is. A click turns it and
 * stops short of the door.
 */
function StarControl({ thread }: { thread: Thread }) {
  const { taskId } = useOrchestrator();
  const star = useMutation(
    rpcClient.workspace.orchestrator.threads.star.mutationOptions(),
  );
  return (
    <button
      aria-label={thread.starred ? "Unstar" : "Star"}
      aria-pressed={thread.starred}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-sm",
        thread.starred
          ? "hover:text-warning-600 text-warning-500"
          : "text-muted-foreground/40 group-hover/row:text-muted-foreground hover:text-warning-500",
      )}
      onAuxClick={stopHere}
      onClick={(event) => {
        stopHere(event);
        star.mutate({
          id: taskId,
          sessionId: thread.id,
          starred: !thread.starred,
        });
      }}
      type="button"
    >
      <StarIcon
        className="size-3.5"
        weight={thread.starred ? "fill" : "bold"}
      />
    </button>
  );
}

/**
 * Where the thread stands, as a dot: amber while it waits on the user, brand
 * and breathing while it works, brand and still while it holds replies not
 * yet seen, and nothing at all while it is quiet, so the gutter is empty down
 * a list with nothing new in it.
 */
function StateDot({ thread }: { thread: Thread }) {
  if (thread.state === "waiting") {
    return (
      <span
        aria-label="Needs you"
        className="size-2 shrink-0 rounded-full bg-warning-500"
      />
    );
  }
  if (thread.state === "working") {
    // Breathing, the way the agent's own dot breathes while it plans, so a
    // thread at work reads apart from one merely holding something unread.
    return (
      <span
        aria-label="Working"
        className="planning-dot-core size-2 shrink-0 rounded-full bg-brand-500 motion-reduce:animate-none"
      />
    );
  }
  if (thread.unread > 0) {
    return (
      <span
        aria-label="Unread"
        className="size-2 shrink-0 rounded-full bg-brand-500"
      />
    );
  }
  return null;
}

/**
 * The control that files the thread, first in the corner's bar: its list
 * is every topic with a check on each that is on, and a new one at the
 * foot. The row keeps its open state, so the bar stays in the flow while
 * the list is up and the list keeps its anchor as it closes.
 */
function TagControl({
  isOpen,
  onNewTopic,
  onOpenChange,
  onToggle,
  thread,
  topics,
}: {
  isOpen: boolean;
  onNewTopic: () => void;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  thread: Thread;
  topics: Topic[];
}) {
  return (
    // The list is drawn elsewhere on the page but is this span's in React's
    // eyes, so a pick inside it stops here rather than opening the thread. A
    // right click stops only inside the list: on the control it is the row's,
    // and raises the row's menu like a right click on the words.
    <span className="flex shrink-0" onAuxClick={stopHere} onClick={stopHere}>
      <Popover onOpenChange={onOpenChange} open={isOpen}>
        <PopoverTrigger asChild>
          <button
            aria-label="Topics"
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
            title="Topics"
            type="button"
          >
            <TagIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-60 p-1"
          // Focus does not come back to the control as the list closes: the
          // bar would stay for it after the pointer had gone.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onContextMenu={stopHere}
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
            onToggle={onToggle}
            topics={topics}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}
