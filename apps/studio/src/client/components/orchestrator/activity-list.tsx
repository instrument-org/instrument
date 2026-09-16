import { Spinner } from "@/client/components/ui/spinner";
import { Fragment } from "react";

import {
  type ActivityFilters,
  groupRowsByDay,
  matchesActivityFilters,
  type ActivityRow as Row,
} from "./activity";
import { ActivityRow } from "./activity-row";
import { type AppsBySlug } from "./apps-by-slug";
import { type Topic } from "./threads";
import { useNow } from "./use-now";

/**
 * The rows of Activity under their day heads, newest first, or the one line
 * that stands in for them: a spinner until the threads' side has arrived,
 * then why the list is empty when it is. The same list wherever Activity is
 * drawn; the surface around it owns the filters and what happens after a row
 * opens something.
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
  const groups = groupRowsByDay(shown, now);
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {rows.length === 0 ? "Nothing has happened yet." : "Nothing matches."}
      </p>
    );
  }
  return (
    <div>
      {groups.map(([label, group]) => (
        <Fragment key={label}>
          <p className="flex items-center gap-3 px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            {label}
            <span className="h-px flex-1 bg-border" />
          </p>
          {group.map((row) => (
            <ActivityRow
              appsBySlug={appsBySlug}
              key={row.id}
              {...(onOpened ? { onOpened } : {})}
              row={row}
              topicsById={topicsById}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}
