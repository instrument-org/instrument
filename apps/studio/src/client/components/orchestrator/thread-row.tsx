import { THREADS_HREF } from "@/client/atoms/orchestrator";
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
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ArchiveIcon } from "@phosphor-icons/react/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { EnvelopeSimpleOpenIcon } from "@phosphor-icons/react/EnvelopeSimpleOpen";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StarIcon } from "@phosphor-icons/react/Star";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useContext, useState } from "react";
import { toast } from "sonner";

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
import { activityLabel, type Thread, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";
import { topicTint } from "./topic-tint";

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
 * at its end, the latest line gets two, and what it holds sits on a third
 * line that never wraps: the files it made as chips with their names, the
 * apps and sites as marks beside them, fading out at the row's edge. No
 * avatar, no name: every row here is the user's. The pill, the marks, the
 * tag control that stands in front of the pill while the pointer is on the
 * row, and the actions that stand over the time then (putting the thread
 * away or back, marking it read or unread) are the row's own controls, and a
 * click on one stops short of the door. The menu offers the same, with the
 * ways to open the thread and its topics.
 */
export function ThreadRow({
  appsBySlug,
  density,
  isOpen,
  now,
  onNewTopic,
  onOpen,
  onSetTopics,
  thread,
  topics,
}: {
  appsBySlug: AppsBySlug;
  density: RowDensity;
  /** Whether this thread is the one open beside the list. */
  isOpen: boolean;
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
  // The gestures that ask for a place of the thread's own: a middle click or
  // a modified click. A plain click is the caller's.
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });
  const actions = useThreadActions(thread);
  const isUnseen = thread.unread > 0;
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
      onOpenChange={setPicking}
      onToggle={toggleTopic}
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
        "min-w-0 flex-1 truncate text-[13px]",
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
  // How many replies, once there is a conversation to count: the thread's
  // own mark and a number, in muted, never a word.
  const count = thread.replyCount > 1 && (
    <span
      aria-label={`${thread.replyCount} replies`}
      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums"
    >
      <ChatTeardropTextIcon className="size-3" />
      {thread.replyCount}
    </span>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={rowClassName(density, isOpen)}
          data-density={density}
          data-open={isOpen || undefined}
          onAuxClick={gestures.onAuxClick}
          onClick={(event) => {
            if (wantsNewTab(event)) {
              gestures.separate?.run();
              return;
            }
            onOpen();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.target === event.currentTarget) {
              onOpen();
            }
          }}
          role="button"
          tabIndex={0}
        >
          {/* The gutter: the state alone, on the first line's height so the
            dot sits beside the title whatever the row's shape. */}
          <span className="flex h-5 w-4 shrink-0 items-center justify-center">
            <StateDot thread={thread} />
          </span>
          {density === "slim" ? (
            <>
              {/* The title's column is fixed, so every row's latest line
                starts at one edge and the column reads down as a list of
                names. */}
              <span className="flex min-w-0 basis-[38%] items-center gap-1.5">
                {/* The star sits in view on a wide row, where there is room
                  for a mark of the user's own beside the title. */}
                <StarControl thread={thread} />
                {tagControl}
                {pill}
                {title}
              </span>
              <Peek className="min-w-0 flex-1" lines={1} thread={thread} />
              {hasHolds && (
                <HoldsInThread onOpen={onOpen}>
                  <HoldMarks
                    appsBySlug={appsBySlug}
                    className="ml-auto"
                    holds={thread.holds}
                    namedFiles
                  />
                </HoldsInThread>
              )}
              {/* A slot of its own before the time, filled or not, so the
                times line up down the list. */}
              <span className="flex w-9 shrink-0 justify-end">{count}</span>
              <span className="w-14 shrink-0 text-right">{time}</span>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="flex h-5 items-center gap-1.5">
                {tagControl}
                {pill}
                {title}
                {/* A narrow row has no room for the control; the star shows
                  once given, and the row's actions are where it is given. */}
                {thread.starred && (
                  <StarIcon
                    aria-label="Starred"
                    className="size-3.5 shrink-0 text-warning-500"
                    weight="fill"
                  />
                )}
                {/* The count under the time, out of the title's way and the
                  time's: one column at the row's right, the second line of
                  it hanging beside the latest line. */}
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  {time}
                  {count}
                </span>
              </p>
              <Peek
                className={cn("mt-0.5", count && "pr-10")}
                lines={2}
                thread={thread}
              />
              {hasHolds && (
                <HoldsInThread onOpen={onOpen}>
                  <HoldMarks
                    appsBySlug={appsBySlug}
                    className="mt-1 gap-1"
                    holds={thread.holds}
                    namedFiles
                    wrap={false}
                  />
                </HoldsInThread>
              )}
            </div>
          )}
          <RowActionBar actions={actions} density={density} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
        {gestures.separate && (
          <ContextMenuItem onSelect={gestures.separate.run}>
            Open in new tab
          </ContextMenuItem>
        )}
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
 * The topic the thread is filed under, as a pill in its tint no taller than
 * the line it sits on: its emoji, or its mark's tile where it has none, then
 * its name. Clicking it opens the thread's topic list rather than the thread;
 * given nothing to open, it is the name alone and no control.
 */
export function TopicPill({
  onPick,
  topic,
}: {
  onPick?: () => void;
  topic: Topic;
}) {
  // `leading-4` rather than none: the name's box has to hold its descenders,
  // or the clip that truncates it cuts them off.
  const className =
    "inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) pr-1.5 pl-1 text-[11px] leading-4 text-foreground/90 topic-tint";
  const inside = (
    <>
      {topic.emoji ? (
        <span className="text-[10px]">{topic.emoji}</span>
      ) : (
        <TopicMark className="size-3.5 text-[10px]" topic={topic} />
      )}
      <span className="truncate">{topic.name}</span>
    </>
  );
  if (!onPick) {
    return (
      <span className={className} style={topicTint(topicColor(topic))}>
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
      onContextMenu={stopHere}
      style={topicTint(topicColor(topic))}
      title="Topics"
      type="button"
    >
      {inside}
    </button>
  );
}

/**
 * Names the openers for the marks of what a thread holds: a hold is the
 * thread's, so opening one opens the thread first and then the hold as a
 * tab inside the thread's group, never in place of whatever the right area
 * had up. A middle or modified click asks for the same tab.
 */
function HoldsInThread({
  children,
  onOpen,
}: {
  children: ReactNode;
  /** Opens the thread, which brings its group on screen. */
  onOpen: () => void;
}) {
  const orchestrator = useOrchestrator();
  const openFile = useContext(FileOpenContext);
  return (
    <OrchestratorContext
      value={{
        ...orchestrator,
        openPage: (url) => {
          onOpen();
          orchestrator.openPage(url, { newTab: true });
        },
        openScreen: (href) => {
          onOpen();
          orchestrator.openScreen(href, { newTab: true });
        },
        opensNewTab: true,
      }}
    >
      <FileOpenContext
        value={(path) => {
          onOpen();
          openFile?.(path, { newTab: true });
        }}
      >
        <PageOpenContext
          value={(url) => {
            onOpen();
            orchestrator.openPage(url, { newTab: true });
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
      onContextMenu={stopHere}
      type="button"
    >
      <StarIcon
        className="size-3.5"
        weight={thread.starred ? "fill" : "regular"}
      />
    </button>
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
            onToggle={onToggle}
            topics={topics}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * What a thread offers that no line of it carries, in the order the row's
 * edge and its menu list them: putting it away, or back in the inbox, with
 * an undo in the toast either way; and marking it read while something in
 * it is unseen, or unread again once it has replies to be unread, with no
 * toast at all, since the row itself says which it is.
 */
function useThreadActions(thread: Thread): RowAction[] {
  const { taskId } = useOrchestrator();
  const input = { id: taskId, sessionId: thread.id };
  // Each way's toast offers the other way back, so an undo can be undone.
  // The toasts hang off the mutations rather than off the calls, since the
  // row is gone from the list by the time either lands.
  const archive = useMutation(
    rpcClient.workspace.orchestrator.threads.archive.mutationOptions({
      onError: (error) => {
        toast.error("Failed to archive the thread", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast("Archived", { action: { label: "Undo", onClick: bringBack } });
      },
    }),
  );
  const unarchive = useMutation(
    rpcClient.workspace.orchestrator.threads.unarchive.mutationOptions({
      onError: (error) => {
        toast.error("Failed to move the thread to the inbox", {
          description: error.message,
        });
      },
      onSuccess: () => {
        toast("Moved to Inbox", {
          action: { label: "Undo", onClick: putAway },
        });
      },
    }),
  );
  const seen = useMutation(
    rpcClient.workspace.orchestrator.threads.seen.mutationOptions(),
  );
  const unseen = useMutation(
    rpcClient.workspace.orchestrator.threads.unseen.mutationOptions(),
  );
  const star = useMutation(
    rpcClient.workspace.orchestrator.threads.star.mutationOptions(),
  );
  function putAway() {
    archive.mutate(input);
  }
  function bringBack() {
    unarchive.mutate(input);
  }
  const put: RowAction = thread.archived
    ? {
        icon: <ArrowCounterClockwiseIcon className="size-3.5" />,
        id: "unarchive",
        label: "Unarchive",
        run: bringBack,
      }
    : {
        icon: <ArchiveIcon className="size-3.5" />,
        id: "archive",
        label: "Archive",
        run: putAway,
      };
  const mark: RowAction[] =
    thread.unread > 0
      ? [
          {
            icon: <EnvelopeSimpleOpenIcon className="size-3.5" />,
            id: "read",
            label: "Mark as read",
            run: () => {
              seen.mutate(input);
            },
          },
        ]
      : thread.replyCount > 0
        ? [
            {
              icon: <EnvelopeSimpleIcon className="size-3.5" />,
              id: "unread",
              label: "Mark as unread",
              run: () => {
                unseen.mutate(input);
              },
            },
          ]
        : [];
  const starred: RowAction = thread.starred
    ? {
        icon: <StarIcon className="size-3.5" weight="fill" />,
        id: "unstar",
        label: "Unstar",
        run: () => {
          star.mutate({ ...input, starred: false });
        },
      }
    : {
        icon: <StarIcon className="size-3.5" />,
        id: "star",
        label: "Star",
        run: () => {
          star.mutate({ ...input, starred: true });
        },
      };
  return [put, ...mark, starred];
}

/**
 * Whether a click asks for a tab of its own. One modifier, the one the
 * platform means it by: on macOS Ctrl and a click is the secondary click, so
 * answering it with a tab would take the gesture away from the menu.
 */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
