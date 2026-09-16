import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { SkillMentionText } from "@/client/components/skill-mention-text";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useRelativeTime } from "@/client/hooks/use-relative-time";
import { cn } from "@/client/lib/utils";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { TagIcon } from "@phosphor-icons/react/Tag";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";

import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { askOf, basename, type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";
import { TopicPickList } from "./topic-menu";

/** How many files a row names before the rest are a count. */
const FILES_SHOWN = 3;

/** How many site marks a working row shows beside its step. */
const SITES_SHOWN = 4;

/**
 * One thread in the chat. One header line carries the title and the facts:
 * a dot when there is state, the title in bold, the time, the topic marks,
 * the count or what the thread wants, when it last moved, and what it holds.
 * The ask sits under it exactly as it was typed, clamped with a fade, and one
 * peer line says where the thread stands: the latest reply, the step it is
 * working through, or the question it is waiting on. No avatar, no name: every
 * row here is the user's. The row is a door; the controls at its edge tag it
 * or open it without leaving the list.
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
  onOpen: () => void;
  onSetTopics: (topics: string[]) => void;
  thread: Thread;
  topics: Topic[];
}) {
  const isWaiting = thread.state === "waiting";
  const isWorking = thread.state === "working";
  const hasUnread = thread.unread > 0;
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const marks = thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
  const latestAt = thread.latest?.at ?? thread.updatedAt;
  const [isTagging, setTagging] = useState(false);

  return (
    // A plain click anywhere on the row opens the thread; the Open control at
    // its edge is the same door for the keyboard.
    <div
      className="group/row relative rounded-md px-2 py-2 hover:bg-foreground/4 has-[[data-state=open]]:bg-foreground/4"
      onClick={onOpen}
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
        <span className="truncate font-semibold">{thread.title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {format(thread.createdAt, "h:mm a")}
        </span>
        {marks.map((topic) => (
          <TopicMark key={topic.id} size="sm" topic={topic} />
        ))}
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {isWaiting ? (
            <span className="flex shrink-0 items-center gap-0.5 font-medium text-warning-700 dark:text-warning-300">
              <QuestionIcon className="size-3" weight="bold" />
              Needs you
            </span>
          ) : hasUnread ? (
            <span className="shrink-0 font-semibold text-brand-700 dark:text-brand-300">
              {thread.unread} new
            </span>
          ) : (
            <span className="shrink-0 font-medium">
              {thread.replyCount}{" "}
              {thread.replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
          {thread.replyCount > 0 && (
            <>
              <CaretRightIcon className="size-2.5 shrink-0" />
              <Freshness at={latestAt} />
            </>
          )}
          <Holds appsBySlug={appsBySlug} holds={thread.holds} />
        </span>
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
              {firstLine(thread.latest?.text) || "Waiting on you"}
            </span>
          </p>
        ) : isWorking ? (
          <p className="flex items-center gap-1.5 text-[12px]">
            {/* `brand-shiny-text` is an inline-block, which a parent's truncate
              cannot shrink, so the step carries its own. */}
            <span className="brand-shiny-text min-w-0 truncate">
              {thread.runningTasks.find((task) => task.step)?.step ??
                firstLine(thread.latest?.text) ??
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
            {firstLine(thread.latest?.text) || "No reply yet"}
          </p>
        )}
      </div>
      {/* At the row's edge, over the header line, only while the pointer is
        on the row or a menu of its is open. */}
      <div
        className="absolute top-1 right-1.5 flex items-center gap-0.5 rounded-md bg-background/90 opacity-0 shadow-xs ring-1 ring-border backdrop-blur-xs group-hover/row:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
        }}
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
        <button
          aria-label="Open thread"
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={onOpen}
          title="Open"
          type="button"
        >
          <ArrowSquareOutIcon className="size-3.5" />
        </button>
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

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split("\n").find((entry) => entry.trim() !== "");
  return line?.trim() || undefined;
}

/** When the thread last moved, kept current as it sits on screen. */
function Freshness({ at }: { at: number }) {
  const ago = useRelativeTime(new Date(at), { compact: true });
  return <span className="shrink-0">last reply {ago}</span>;
}

/**
 * What the thread has made and used, behind a hairline: the files by name
 * with their type's icon, then the apps and the sites as bare marks. Left in
 * reading order, clipped rather than wrapped, so the header stays one line.
 */
function Holds({
  appsBySlug,
  holds,
}: {
  appsBySlug: AppsBySlug;
  holds: Thread["holds"];
}) {
  const files = holds.files.slice(0, FILES_SHOWN);
  const moreFiles = holds.files.length - files.length;
  if (
    files.length === 0 &&
    holds.apps.length === 0 &&
    holds.sites.length === 0
  ) {
    return null;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden border-l border-border pl-2 whitespace-nowrap">
      {files.map((path) => (
        <span
          className="inline-flex h-5 max-w-36 shrink-0 items-center gap-1 rounded border border-border bg-card px-1 text-[10px] text-foreground/80"
          key={path}
          title={path}
        >
          <FileIcon className="size-3 shrink-0" filename={basename(path)} />
          <span className="truncate">{basename(path)}</span>
        </span>
      ))}
      {moreFiles > 0 && <span className="shrink-0">+{moreFiles}</span>}
      {holds.apps.map((slug) => (
        <AppIcon
          className="size-3.5"
          key={slug}
          site={appsBySlug.get(slug)?.site}
          size="sm"
        />
      ))}
      {holds.sites.map((site) => (
        <Favicon
          className="size-3.5 shrink-0"
          key={site}
          url={`https://${site}`}
        />
      ))}
    </span>
  );
}
