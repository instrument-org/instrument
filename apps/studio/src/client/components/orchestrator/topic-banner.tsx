import { format } from "date-fns";

import { type AppsBySlug } from "./apps-by-slug";
import { HoldMarks } from "./hold-marks";
import { type Thread, type Topic } from "./threads";
import { TopicMark } from "./topic-mark";

/** How many marks the banner's strip shows before the rest fold into a count: a banner has more room than a row. */
const MARKS_SHOWN = 12;

/**
 * What sits above the rows while the list is filtered to one topic: the
 * topic's mark and name, one line about it, and a strip of what its threads
 * hold as marks. The name is said once and the count once, in that line,
 * and only when the topic has no words of its own about what it is for.
 */
export function TopicBanner({
  appsBySlug,
  threads,
  topic,
}: {
  appsBySlug: AppsBySlug;
  /** The threads filed under the topic, which is what it holds. */
  threads: Thread[];
  topic: Topic;
}) {
  const holds = holdsOf(threads);
  const hasHolds =
    holds.apps.length > 0 || holds.files.length > 0 || holds.sites.length > 0;
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
      <TopicMark size="lg" topic={topic} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 font-semibold">{topic.name}</p>
        <p className="truncate text-xs leading-4 text-muted-foreground">
          {topic.about || sinceLine(threads)}
        </p>
        {hasHolds && (
          <HoldMarks
            appsBySlug={appsBySlug}
            className="mt-1.5 -ml-0.5"
            holds={holds}
            shown={MARKS_SHOWN}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Everything the topic's threads hold, each thing once, with what the newest
 * thread holds first so the strip's front is the topic's latest work.
 */
function holdsOf(threads: Thread[]): Thread["holds"] {
  const newestFirst = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  // A row lists its files newest last and draws them reversed, so the
  // banner's files are gathered oldest first to draw the same way.
  const oldestFirst = newestFirst.toReversed();
  return {
    apps: [...new Set(newestFirst.flatMap((thread) => thread.holds.apps))],
    files: [...new Set(oldestFirst.flatMap((thread) => thread.holds.files))],
    sites: [...new Set(oldestFirst.flatMap((thread) => thread.holds.sites))],
  };
}

/** What the banner says about a topic that says nothing about itself: how much is filed here, and since when. */
function sinceLine(threads: Thread[]): string {
  if (threads.length === 0) {
    return "Nothing filed here yet";
  }
  const since = Math.min(...threads.map((thread) => thread.createdAt));
  const count = `${threads.length} ${threads.length === 1 ? "thread" : "threads"}`;
  return `${count} since ${format(since, "MMM d")}`;
}
