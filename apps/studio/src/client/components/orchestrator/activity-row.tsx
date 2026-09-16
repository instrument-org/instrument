import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { RelativeTime } from "@/client/components/relative-time";
import { InstrumentGlyph } from "@/client/components/wordmark";
import {
  useGesturesFor,
  useOpenGestures,
} from "@/client/hooks/use-open-target";
import { isMacOS } from "@/client/lib/utils";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { FilePlusIcon } from "@phosphor-icons/react/FilePlus";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { HourglassIcon } from "@phosphor-icons/react/Hourglass";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt";
import { PlayIcon } from "@phosphor-icons/react/Play";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { type MouseEvent, type ReactNode } from "react";

import {
  type ActivityEntry,
  lookedText,
  type ActivityRow as Row,
  rowTarget,
  targetKey,
  type Visit,
} from "./activity";
import { AppIcon } from "./app-icon";
import { type AppsBySlug } from "./apps-by-slug";
import { THREADS_HREF } from "./screen-presentation";
import { SiteIcon } from "./sidebar";
import { basename, type Topic } from "./threads";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { topicTint } from "./topic-tint";

/** How many of a run's visits a row names before the rest are the count. */
const VISITS_NAMED = 3;

/** How many files a row names before the rest are a count. */
const FILES_SHOWN = 3;

const ICON = "size-4 shrink-0 text-muted-foreground";

/** What each kind of entry is drawn with, and the word the row leads with. */
const KINDS: Record<ActivityEntry["kind"], { icon: ReactNode; label: string }> =
  {
    asked: {
      icon: <PaperPlaneTiltIcon className={ICON} />,
      label: "You asked",
    },
    askedYou: { icon: <QuestionIcon className={ICON} />, label: "Asked you" },
    madeFile: { icon: <FilePlusIcon className={ICON} />, label: "Made" },
    openedPage: { icon: <GlobeIcon className={ICON} />, label: "Opened" },
    replied: {
      icon: <ChatTeardropTextIcon className={ICON} />,
      label: "Replied",
    },
    startedTask: { icon: <PlayIcon className={ICON} />, label: "Started" },
    taskFailed: {
      icon: <WarningCircleIcon className={ICON} />,
      label: "Failed",
    },
    taskFinished: {
      icon: <CheckCircleIcon className={ICON} />,
      label: "Finished",
    },
    taskOverdue: { icon: <HourglassIcon className={ICON} />, label: "Overdue" },
    usedApp: { icon: <AppWindowIcon className={ICON} />, label: "Used" },
  };

/** The gestures a door answers, as the hook hands them back for one target. */
type Gestures = ReturnType<ReturnType<typeof useGesturesFor>>;

/**
 * What every row of Activity is drawn as, the head of a group and the lines
 * under it alike, so a day reads as one column whichever kind of line the eye
 * is on. Not text: no selection and no text cursor over it.
 */
const ROW =
  "group/row flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] select-none hover:bg-foreground/4";

/**
 * One line of Activity, in the chat's row grammar: a mark for the kind at the
 * left, the word for it, the text, the marks for what it made or used, and
 * how long ago at the end. No avatar, no bubble, and no thread name: the row
 * sits under its thread's head, which carries that. The row is a door, not
 * text: a plain click opens the thread in place, or the task when the line
 * is about one, or brings back what was looked at; a middle or modified
 * click asks for a tab of its own, and a right click offers both.
 */
export function ActivityRow({
  appsBySlug,
  onOpened,
  row,
}: {
  appsBySlug: AppsBySlug;
  /** Told after the row, or a chip on it, opened something, for a surface that should get out of the way then. */
  onOpened?: () => void;
  row: Row;
}) {
  const target = rowTarget(row);
  const gestures = useOpenGestures(target ?? { href: "", kind: "screen" });
  const open = target ? openerOf(gestures, onOpened) : undefined;
  return (
    <div
      className={ROW}
      onAuxClick={target ? auxOpenerOf(gestures, onOpened) : undefined}
      onClick={open}
      onContextMenu={target ? gestures.onContextMenu : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          open?.(event);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {row.kind === "entry" ? (
        <Entry appsBySlug={appsBySlug} entry={row.entry} />
      ) : (
        <Looked onOpened={onOpened} visits={row.visits} />
      )}
      <Ago at={row.at} />
    </div>
  );
}

/**
 * The head a thread's entries for the day sit under: the thread's title, the
 * topics it is filed under as readable pills, and how long ago its newest
 * entry landed at the end. A door to the thread itself, answering the same
 * gestures as the rows under it.
 */
export function ThreadHeadRow({
  at,
  onOpened,
  thread,
  topicsById,
}: {
  /** When the newest entry under the head landed. */
  at: number;
  /** Told after the head opened the thread, for a surface that should get out of the way then. */
  onOpened?: () => void;
  thread: ActivityEntry["thread"];
  topicsById: Map<string, Topic>;
}) {
  const gestures = useOpenGestures({
    href: `${THREADS_HREF}/${thread.id}`,
    kind: "screen",
  });
  const open = openerOf(gestures, onOpened);
  const marks = thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
  return (
    <div
      className={ROW}
      onAuxClick={auxOpenerOf(gestures, onOpened)}
      onClick={open}
      onContextMenu={gestures.onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          open(event);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="min-w-0 truncate font-medium">{thread.title}</span>
      {marks.map((topic) => (
        <TopicPill key={topic.id} topic={topic} />
      ))}
      <Ago at={at} />
    </div>
  );
}

/** How long ago, at the far end of a row, with the moment itself on hover; the day head above carries the date. */
function Ago({ at }: { at: number }) {
  return (
    <RelativeTime
      className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
      compact
      date={new Date(at)}
    />
  );
}

/**
 * A middle click, which asks for a tab of its own. The hook answers it by
 * consuming the event, so the window does not hand the address to the OS
 * browser, and a consumed event is one that opened something.
 */
function auxOpenerOf(gestures: Gestures, onOpened: (() => void) | undefined) {
  return (event: MouseEvent) => {
    gestures.onAuxClick(event);
    if (event.defaultPrevented) {
      onOpened?.();
    }
  };
}

function Entry({
  appsBySlug,
  entry,
}: {
  appsBySlug: AppsBySlug;
  entry: ActivityEntry;
}) {
  const { icon, label } = KINDS[entry.kind];
  const text =
    entry.kind === "usedApp"
      ? (appsBySlug.get(entry.text)?.name ?? entry.text)
      : entry.text;
  return (
    <>
      {icon}
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate">{text}</span>
      <Marks appsBySlug={appsBySlug} marks={entry.marks} />
    </>
  );
}

/**
 * A run of what the window showed: the count by kind, and the first few by
 * name with their own marks, each a door back to it. A chip's gestures are
 * its own and stop at it, so the row under it does not open as well.
 */
function Looked({
  onOpened,
  visits,
}: {
  onOpened: (() => void) | undefined;
  visits: Visit[];
}) {
  const gesturesFor = useGesturesFor();
  const named = visits.length === 1 ? [] : visits.slice(0, VISITS_NAMED);
  return (
    <>
      <EyeIcon className={ICON} />
      <span className="shrink-0 text-[11px] text-muted-foreground">
        You looked at
      </span>
      {visits.length === 1 && visits[0] ? (
        <span className="flex min-w-0 items-center gap-1">
          <VisitIcon visit={visits[0]} />
          <span className="truncate">{lookedText(visits)}</span>
        </span>
      ) : (
        <span className="min-w-0 truncate">{lookedText(visits)}</span>
      )}
      {named.length > 0 && (
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden border-l border-border pl-2 whitespace-nowrap">
          {named.map((visit) => {
            const gestures = gesturesFor(visit.target);
            const open = openerOf(gestures, onOpened);
            const auxOpen = auxOpenerOf(gestures, onOpened);
            return (
              <button
                className="inline-flex h-5 max-w-36 shrink-0 items-center gap-1 rounded border border-border bg-card px-1 text-[10px] text-foreground/80 hover:bg-accent"
                key={targetKey(visit.target)}
                onAuxClick={(event) => {
                  event.stopPropagation();
                  auxOpen(event);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  open(event);
                }}
                onContextMenu={(event) => {
                  event.stopPropagation();
                  gestures.onContextMenu(event);
                }}
                title={visit.title}
                type="button"
              >
                <VisitIcon visit={visit} />
                <span className="truncate">{visit.title}</span>
              </button>
            );
          })}
          {visits.length > named.length && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              +{visits.length - named.length}
            </span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * What an entry made or used, behind a hairline: the files by name with
 * their type's icon, then the apps and the sites as bare marks.
 */
function Marks({
  appsBySlug,
  marks,
}: {
  appsBySlug: AppsBySlug;
  marks: ActivityEntry["marks"];
}) {
  const files = (marks?.files ?? []).slice(0, FILES_SHOWN);
  const moreFiles = (marks?.files?.length ?? 0) - files.length;
  const apps = marks?.apps ?? [];
  const sites = marks?.sites ?? [];
  if (files.length === 0 && apps.length === 0 && sites.length === 0) {
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
      {moreFiles > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          +{moreFiles}
        </span>
      )}
      {apps.map((slug) => (
        <AppIcon
          className="size-3.5"
          key={slug}
          site={appsBySlug.get(slug)?.site}
          size="sm"
        />
      ))}
      {sites.map((site) => (
        <Favicon
          className="size-3.5 shrink-0"
          key={site}
          url={`https://${site}`}
        />
      ))}
    </span>
  );
}

/**
 * A click on a door: plain, it opens where the surface says, in place; with
 * the modifier the platform means a tab by, it asks for a tab of its own,
 * the way a middle click does. One modifier: on macOS Ctrl and a click is the
 * secondary click, which belongs to the menu.
 */
function openerOf(gestures: Gestures, onOpened: (() => void) | undefined) {
  return (event: { ctrlKey: boolean; metaKey: boolean }) => {
    const wantsNewTab = isMacOS() ? event.metaKey : event.ctrlKey;
    const destination = wantsNewTab
      ? gestures.separate
      : gestures.destinations.find((entry) => entry.id === "open");
    if (!destination) {
      return;
    }
    destination.run();
    onOpened?.();
  };
}

/**
 * A topic a thread is filed under, readable as a badge: its emoji, or its
 * mark's tile where it has none, then its name, on a pill in its tint no
 * taller than the line it sits on. Says nothing on hover, since the head it
 * sits on is the door and the pill is not one.
 */
function TopicPill({ topic }: { topic: Topic }) {
  return (
    <span
      className="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full bg-(--topic-tint-surface) py-px pr-1.5 pl-1 text-[11px] leading-none text-foreground/90 topic-tint"
      style={topicTint(topicColor(topic))}
    >
      {topic.emoji ? (
        <span className="text-[10px]">{topic.emoji}</span>
      ) : (
        <TopicMark className="size-3.5 text-[10px]" topic={topic} />
      )}
      <span className="truncate">{topic.name}</span>
    </span>
  );
}

/** The same mark the tab strip gives the thing: its type for a file, the folder, the glyph, the site's icon. */
function VisitIcon({ visit }: { visit: Visit }) {
  switch (visit.kind) {
    case "file": {
      return <FileIcon className="size-3.5 shrink-0" filename={visit.title} />;
    }
    case "folder": {
      return <FileSystemFolderGlyph className="h-3 w-auto shrink-0" />;
    }
    case "page": {
      return (
        // Its own box, so a row short of room clips the chip's name rather
        // than pressing the favicon narrow.
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center [&_img]:size-3.5 [&_svg]:size-3.5">
          <SiteIcon
            favicon={visit.favicon}
            url={visit.target.kind === "page" ? visit.target.url : undefined}
          />
        </span>
      );
    }
    case "task": {
      return <InstrumentGlyph className="size-3.5 shrink-0" />;
    }
  }
}
