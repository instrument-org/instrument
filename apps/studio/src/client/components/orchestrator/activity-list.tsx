import { Spinner } from "@/client/components/ui/spinner";
import { Fragment } from "react";

import {
  type ActivityFilters,
  groupRowsByDay,
  matchesActivityFilters,
  type ActivityRow as Row,
  type ThreadGroup,
} from "./activity";
import { ActivityRow, ThreadHeadRow } from "./activity-row";
import { type AppsBySlug } from "./apps-by-slug";
import { type Topic } from "./threads";
import { useNow } from "./use-now";

/**
 * Activity under its day heads, newest first, each day gathered by thread: a
 * head row naming the thread with its topics, and what the thread did that
 * day indented under it; a run of what the window showed sits among the
 * threads where its time puts it. Or the one line that stands in for all of
 * it: a spinner until the threads' side has arrived, then why the list is
 * empty when it is. The same list wherever Activity is drawn; the surface
 * around it owns the filters and what happens after a row opens something.
 */
export function ActivityList({
  appsBySlug,
  filters,
  isLoading,
  onOpened,
  rows,
  topics,
}: {
  appsBySlug: AppsBySlug;
  filters: ActivityFilters;
  /** Whether the threads' entries are still on their way. */
  isLoading: boolean;
  /** Told after a row opened something, for a surface that should get out of the way then. */
  onOpened?: () => void;
  rows: Row[];
  topics: Topic[];
}) {
  const now = useNow();
  const shown = rows.filter((row) => matchesActivityFilters(row, filters));
  const days = groupRowsByDay(shown, now);
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (days.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {rows.length === 0 ? "Nothing has happened yet." : "Nothing matches."}
      </p>
    );
  }
  return (
    <div>
      {days.map(([label, items]) => (
        <Fragment key={label}>
          <p className="flex items-center gap-3 px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            {label}
            <span className="h-px flex-1 bg-border" />
          </p>
          {items.map((item) =>
            item.kind === "thread" ? (
              <Group
                appsBySlug={appsBySlug}
                group={item}
                key={item.id}
                {...(onOpened ? { onOpened } : {})}
                topicsById={topicsById}
              />
            ) : (
              <ActivityRow
                appsBySlug={appsBySlug}
                key={item.id}
                {...(onOpened ? { onOpened } : {})}
                row={item}
              />
            ),
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One thread's day: its head, and its entries stepped in under it, newest
 * first, hung off a hairline so the eye reads them as the head's.
 */
function Group({
  appsBySlug,
  group,
  onOpened,
  topicsById,
}: {
  appsBySlug: AppsBySlug;
  group: ThreadGroup;
  onOpened?: () => void;
  topicsById: Map<string, Topic>;
}) {
  return (
    <div>
      <ThreadHeadRow
        at={group.at}
        {...(onOpened ? { onOpened } : {})}
        thread={group.thread}
        topicsById={topicsById}
      />
      <div className="ml-4 border-l border-border pl-1">
        {group.rows.map((row) => (
          <ActivityRow
            appsBySlug={appsBySlug}
            key={row.id}
            {...(onOpened ? { onOpened } : {})}
            row={row}
          />
        ))}
      </div>
    </div>
  );
}
