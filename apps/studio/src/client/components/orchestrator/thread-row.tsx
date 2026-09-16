import { Favicon } from "@/client/components/favicon";
import { SkillMentionText } from "@/client/components/skill-mention-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { format } from "date-fns";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { HoldsStrip } from "./holds-strip";
import { THREADS_HREF } from "./screen-presentation";
import { askOf, type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";

/** How many site marks a working row shows beside its step. */
const SITES_SHOWN = 4;

/**
 * One thread in the chat, in four lines. The header: a dot when there is
 * state, the title in bold with the line to itself, the time, the topic
 * marks. The ask under it exactly as it was typed, clamped with a fade. One
 * peer line saying where the thread stands: the latest reply, the step it is
 * working through, or the question it is waiting on. And a foot the way a
 * thread's is in a chat: the count of replies, or what the thread wants, then
 * what it holds, clipping at the edge. No avatar, no name: every row here is
 * the user's. The row is a door; the control at its edge tags it without
 * leaving the list.
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
  const isWaiting = thread.state === "waiting";
  const isWorking = thread.state === "working";
  const hasUnread = thread.unread > 0;
  const hasHolds =
    thread.holds.apps.length > 0 ||
    thread.holds.files.length > 0 ||
    thread.holds.sites.length > 0;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const marks = thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
  const [isTagging, setTagging] = useState(false);
  // The gestures that ask for a place of the thread's own: a middle click, a
  // modified click, the menu on a right click. A plain click is the caller's.
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });

  return (
    // A click target, not text: no selection and no text cursor over it. The
    // controls inside stop their clicks short of it.
    <div
      className="group/row relative cursor-default rounded-md px-2 py-2 select-none hover:bg-foreground/4 has-[[data-state=open]]:bg-foreground/4"
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
      <p className="flex items-center gap-1.5 text-[13px]">
        {isWaiting ? (
          <span
            aria-label="Needs you"
            className="size-2 shrink-0 rounded-full bg-warning-500"
          />
        ) : hasUnread ? (
          <span
            aria-label="Unread"
            className="size-2 shrink-0 rounded-full bg-brand-500"
          />
        ) : null}
        {/* The title has the line: the time and the marks keep their width,
          and only what is left after them is what the title truncates to. */}
        <span className="min-w-0 truncate font-semibold">{thread.title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {format(thread.createdAt, "h:mm a")}
        </span>
        {marks.map((topic) => (
          <TopicMark key={topic.id} size="sm" topic={topic} />
        ))}
      </p>
      <Ask text={askOf(thread)} />
      <div className="mt-1 border-l-2 border-border pl-3">
        {isWaiting ? (
          <p className="flex items-center gap-1.5 text-[12px] text-foreground/80">
            <QuestionIcon
              className="size-3.5 shrink-0 text-warning-700 dark:text-warning-300"
              weight="bold"
            />
            <span className="truncate">
              {thread.latest?.text || "Waiting on you"}
            </span>
          </p>
        ) : isWorking ? (
          <p className="flex items-center gap-1.5 text-[12px]">
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
          </p>
        ) : (
          <p className="truncate text-[12px] text-foreground/80">
            {thread.latest?.text || "No reply yet"}
          </p>
        )}
      </div>
      {(isWaiting || hasUnread || thread.replyCount > 0 || hasHolds) && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {isWaiting ? (
            <Foot className="font-medium text-warning-700 dark:text-warning-300">
              <QuestionIcon className="size-3" weight="bold" />
              Needs you
            </Foot>
          ) : hasUnread ? (
            <Foot className="font-semibold text-brand-700 dark:text-brand-300">
              {thread.unread} new
            </Foot>
          ) : thread.replyCount > 0 ? (
            <Foot className="font-medium">
              {thread.replyCount}{" "}
              {thread.replyCount === 1 ? "reply" : "replies"}
            </Foot>
          ) : null}
          {hasHolds && (
            <span
              className="flex min-w-0 flex-1"
              onAuxClick={stopHere}
              onClick={stopHere}
              onContextMenu={stopHere}
            >
              <HoldsStrip
                appsBySlug={appsBySlug}
                className="min-w-0 flex-1"
                holds={thread.holds}
                size="sm"
              />
            </span>
          )}
        </div>
      )}
      {/* At the row's edge, over the header line, only while the pointer is
        on the row or its menu is open. */}
      <div
        className="absolute top-1 right-1.5 flex items-center gap-0.5 rounded-md bg-background/90 opacity-0 shadow-xs ring-1 ring-border backdrop-blur-xs group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
        onAuxClick={stopHere}
        onClick={stopHere}
        onContextMenu={stopHere}
      >
        <Popover onOpenChange={setTagging} open={isTagging}>
          <PopoverTrigger asChild>
            <button
              aria-label="Topics"
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:text-foreground"
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
                setTagging(false);
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
      </div>
    </div>
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
    // the row is drawn on, hovered or not.
    <div
      className={cn(
        "mt-0.5 line-clamp-2 text-sm break-words whitespace-pre-wrap",
        isClamped && "mask-b-from-55%",
      )}
      ref={ref}
    >
      <SkillMentionText text={text} />
    </div>
  );
}

/** The foot's first words, with the caret that says the thread opens on them. */
function Foot({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {children}
      <CaretRightIcon className="size-2.5" weight="bold" />
    </span>
  );
}

/** Keeps a control's click from reaching the row under it, which would open the thread. */
function stopHere(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * Whether a click asks for a tab of its own. One modifier, the one the
 * platform means it by: on macOS Ctrl and a click is the secondary click, so
 * answering it with a tab would take the gesture away from the menu.
 */
function wantsNewTab(event: { ctrlKey: boolean; metaKey: boolean }) {
  return isMacOS() ? event.metaKey : event.ctrlKey;
}
