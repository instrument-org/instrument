import { FileSystemFolderGlyph } from "@/client/components/extend/file-system";
import { Favicon } from "@/client/components/favicon";
import { FileIcon } from "@/client/components/file-icon";
import { InstrumentGlyph } from "@/client/components/wordmark";
import {
  useGesturesFor,
  useOpenGestures,
} from "@/client/hooks/use-open-target";
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
import { format } from "date-fns";
import { type ReactNode } from "react";

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
import { SiteIcon } from "./sidebar";
import { basename, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

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

/**
 * One line of Activity, in the chat's row grammar: a mark for the kind at the
 * left, the word for it, the text, the marks for what it made or used, the
 * thread it happened in with its topic marks, and the time at the end. No
 * avatar, no bubble. The row is a door: a plain click opens the thread, or
 * the task when the line is about one, or brings back what was looked at.
 */
export function ActivityRow({
  appsBySlug,
  row,
  topicsById,
}: {
  appsBySlug: AppsBySlug;
  row: Row;
  topicsById: Map<string, Topic>;
}) {
  const target = rowTarget(row);
  const gestures = useOpenGestures(target ?? { href: "", kind: "screen" });
  const open = target
    ? gestures.destinations.find((destination) => destination.id === "open")
    : undefined;
  return (
    <div
      className="group/row flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-foreground/4"
      onAuxClick={target ? gestures.onAuxClick : undefined}
      onClick={() => {
        open?.run();
      }}
      onContextMenu={target ? gestures.onContextMenu : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          open?.run();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {row.kind === "entry" ? (
        <Entry
          appsBySlug={appsBySlug}
          entry={row.entry}
          topicsById={topicsById}
        />
      ) : (
        <Looked visits={row.visits} />
      )}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {format(row.at, "h:mm a")}
      </span>
    </div>
  );
}

function Entry({
  appsBySlug,
  entry,
  topicsById,
}: {
  appsBySlug: AppsBySlug;
  entry: ActivityEntry;
  topicsById: Map<string, Topic>;
}) {
  const { icon, label } = KINDS[entry.kind];
  const marks = entry.thread.topics.flatMap((id) => {
    const topic = topicsById.get(id);
    return topic ? [topic] : [];
  });
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
      <span className="flex max-w-64 min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{entry.thread.title}</span>
        {marks.map((topic) => (
          <TopicMark key={topic.id} size="sm" topic={topic} />
        ))}
      </span>
    </>
  );
}

/**
 * A run of what the window showed: the count by kind, and the first few by
 * name with their own marks, each a door back to it.
 */
function Looked({ visits }: { visits: Visit[] }) {
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
            const open = gestures.destinations.find(
              (destination) => destination.id === "open",
            );
            return (
              <button
                className="inline-flex h-5 max-w-36 shrink-0 items-center gap-1 rounded border border-border bg-card px-1 text-[10px] text-foreground/80 hover:bg-accent"
                key={targetKey(visit.target)}
                onAuxClick={gestures.onAuxClick}
                onClick={(event) => {
                  event.stopPropagation();
                  open?.run();
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
        <span className="[&_img]:size-3.5 [&_svg]:size-3.5">
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
