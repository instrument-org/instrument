import { TaskRow } from "@/client/components/orchestrator/task-row";
import { Input } from "@/client/components/ui/input";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useState } from "react";

/** One task as the list needs it. */
export interface TaskListItem {
  channel?: string;
  id: TaskId;
  line: string;
  standing: "done" | "running" | "waiting";
  title: string;
  updatedAt: Date;
}

type Filter = "all" | "running" | "waiting";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "waiting", label: "Waiting" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The tasks, newest first, under the day they belong to.
 *
 * Time is the only order: the channel a task came from is written on its row
 * and never groups it, because a task is looked for by when it was asked for.
 * The groups are the ones a mail or photo app would use, which is what makes a
 * month of them scannable without a scrollbar's worth of reading.
 */
export function TaskList({
  items,
  onOpen,
  openId,
}: {
  items: TaskListItem[];
  onOpen: (id: TaskId) => void;
  openId?: TaskId;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = items.filter((item) => {
    if (filter === "running" && item.standing !== "running") {
      return false;
    }
    if (filter === "waiting" && item.standing !== "waiting") {
      return false;
    }
    return (
      !words ||
      item.title.toLowerCase().includes(words) ||
      item.line.toLowerCase().includes(words) ||
      (item.channel ?? "").toLowerCase().includes(words)
    );
  });
  const groups = groupByDay(shown);
  const runningCount = items.filter(
    (item) => item.standing === "running",
  ).length;
  return (
    <div className="@container/tasks flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 px-3">
        <h1 className="text-sm font-semibold">Tasks</h1>
        <div className="flex items-center gap-2 text-xs">
          {FILTERS.map((entry) => (
            <button
              className={cn(
                "rounded px-1",
                filter === entry.id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={entry.id}
              onClick={() => {
                setFilter(entry.id);
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        {filter === "running" && runningCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {runningCount} running
          </span>
        )}
        <div className="relative ml-auto hidden w-40 @[26rem]/tasks:block">
          <MagnifyingGlassIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 pl-7 text-xs"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search tasks"
            value={query}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            {items.length === 0
              ? "Nothing yet. Ask for something in any channel and it shows up here."
              : "Nothing matches."}
          </p>
        ) : (
          groups.map(([label, group]) => (
            <div key={label}>
              <p className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {label}
              </p>
              {group.map((item) => (
                <TaskRow
                  channel={item.channel}
                  isOpen={item.id === openId}
                  key={item.id}
                  line={item.line}
                  onOpen={() => {
                    onOpen(item.id);
                  }}
                  standing={item.standing}
                  time={timeOf(item.updatedAt)}
                  title={item.title}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Which day's heading a task belongs under, from today outward. */
function dayLabel(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 0) {
    return "Today";
  }
  if (days < 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return "This week";
  }
  if (days < 14) {
    return "Last week";
  }
  return date.toLocaleDateString(undefined, {
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function groupByDay(items: TaskListItem[]): [string, TaskListItem[]][] {
  const now = new Date();
  const groups: [string, TaskListItem[]][] = [];
  for (const item of [...items].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )) {
    const label = dayLabel(item.updatedAt, now);
    const last = groups.at(-1);
    if (last && last[0] === label) {
      last[1].push(item);
    } else {
      groups.push([label, [item]]);
    }
  }
  return groups;
}

/**
 * The time on a row: the clock for what the day's heading already dates, the
 * weekday for this week, the date for anything older.
 */
function timeOf(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 1) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
