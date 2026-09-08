import { type TaskId } from "../../schemas/task-id";

/**
 * How long each unit a span may be written in lasts. A month and a year are
 * the round figures a question uses rather than calendar arithmetic, since a
 * listing filtered to "the last 6mo" is asking roughly, not to the day.
 */
const SPAN_UNITS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  mo: 30 * 86_400_000,
  s: 1000,
  w: 7 * 86_400_000,
  y: 365 * 86_400_000,
};

/**
 * How many tasks `task list` shows before it asks to be narrowed.
 *
 * A conversation that has run for months has hundreds of tasks, and the whole
 * list is both more than an answer needs and more than the bash tool will
 * carry: past its budget the output is cut head-and-tail, which for a list in
 * activity order spends half the room on the oldest rows and drops the middle
 * without the reader being able to tell which rows went. A window plus a count
 * of what it left is the same information bounded, and it says out loud that
 * there is more, which is what stops an answer being drawn from a partial list.
 */
export const TASK_LIST_WINDOW = 25;

/** What a `task list` invocation asked for. */
export interface TaskListQuery {
  all?: boolean;
  limit?: number;
  running?: boolean;
  since?: Date;
  until?: Date;
}

/** One task as the listing needs it. */
export interface TaskListRow {
  id: TaskId;
  isRunning: boolean;
  title: string;
  updatedAt: Date;
}

export interface TaskListSelection {
  /** Matched the query but fell outside the window, and so goes in the footer. */
  omitted: number;
  shown: TaskListRow[];
  total: number;
}

/** A task that matched a search, with what it said about the term. */
export interface TaskSearchRow extends TaskListRow {
  /** Text parts that matched; zero when only the name did. */
  count: number;
  snippet: string;
}

export interface TaskSearchSelection {
  omitted: number;
  shown: TaskSearchRow[];
  total: number;
}

/**
 * How long ago something happened, in one unit.
 *
 * `ms` has no unit above the day, so a task last touched in the spring reads
 * as "146d ago" and has to be divided before it means anything. Months and
 * years are how the question is asked, so they are how the answer is given.
 */
export function formatAge(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months}mo`;
  }
  return `${Math.round(days / 365)}y`;
}

/**
 * A `--since` or `--until` value: a calendar day, or a span back from now.
 *
 * Both spellings because both are asked for. A question about a stretch of the
 * calendar ("the middle of August") is a date, and one about the recent past
 * ("this week") is a span, and a listing that took only one of them would send
 * the caller off to compute the other.
 */
export function parseListDate(
  value: string,
  {
    endOfDay = false,
    now = new Date(),
  }: { endOfDay?: boolean; now?: Date } = {},
): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const day = new Date(
      `${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
    );
    if (Number.isNaN(day.getTime())) {
      throw new TypeError(
        `"${value}" is not a date. Use YYYY-MM-DD, or a span like 30d.`,
      );
    }
    return day;
  }
  const span = /^(\d+(?:\.\d+)?)\s*(mo|[smhdwy])$/i.exec(trimmed);
  const size = span ? Number(span[1]) : Number.NaN;
  const unit = span?.[2]?.toLowerCase();
  const perUnit = unit === undefined ? undefined : SPAN_UNITS[unit];
  if (perUnit === undefined || Number.isNaN(size)) {
    throw new Error(
      `"${value}" is not a date or a span. Use YYYY-MM-DD, or a span like 30d, 6mo, 1y.`,
    );
  }
  return new Date(now.getTime() - size * perUnit);
}

/**
 * The listing itself: a column each for the id, whether it is running, the day
 * it was last active, how long ago that was, and its title.
 *
 * The day is written out as well as the age because a listing without one is
 * filtered by reading a date out of the id, which is the day the task was made
 * rather than the day it was last active, and which a quarter of tasks do not
 * carry at all.
 */
export function renderTaskList(
  selection: TaskListSelection,
  { now = new Date() }: { now?: Date } = {},
): string {
  const cells = selection.shown.map((row) => [
    row.id,
    row.isRunning ? "running" : "idle",
    row.updatedAt.toISOString().slice(0, 10),
    `${formatAge(now.getTime() - row.updatedAt.getTime())} ago`,
    row.title,
  ]);
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...cells.map((row) => (row[column] ?? "").length)),
  );
  const table = cells
    .map((row) =>
      row
        .map((cell, column) =>
          column === 4 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join("  "),
    )
    .join("\n");
  if (selection.omitted === 0) {
    return `${table}\n`;
  }
  return `${table}\n\n${moreLine(selection, ", or find one with `task search <words>`")}\n`;
}

/**
 * A search result: the same row, with what the task said about the term under
 * it. The status column goes, since what a task is doing now is not what is
 * being asked; the count stays, because one mention and thirty are different
 * answers and the ordering is built on the difference.
 */
export function renderTaskSearch(
  selection: TaskSearchSelection,
  { now = new Date() }: { now?: Date } = {},
): string {
  const cells = selection.shown.map((row) => [
    row.id,
    row.updatedAt.toISOString().slice(0, 10),
    `${formatAge(now.getTime() - row.updatedAt.getTime())} ago`,
    row.title,
  ]);
  const widths = [0, 1, 2].map((column) =>
    Math.max(...cells.map((row) => (row[column] ?? "").length)),
  );
  const table = selection.shown
    .map((row, index) => {
      const head = (cells[index] ?? [])
        .map((cell, column) =>
          column === 3 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join("  ");
      const mentions = row.count === 0 ? "in its name" : `${row.count}×`;
      return `${head}\n    ${mentions}  ${row.snippet || "matched its name"}`;
    })
    .join("\n");
  if (selection.omitted === 0) {
    return `${table}\n`;
  }
  return `${table}\n\n${moreLine(selection)}\n`;
}

/**
 * The rows a query asks for, and how many it left behind.
 *
 * Every filter runs over the whole list and the window is applied last, so a
 * date range sees every task rather than whichever ones the default window
 * happened to show. A filter that only saw the window would answer "no such
 * task" for a task that is right there, and nothing in the output would say so.
 */
export function selectTasks(
  rows: TaskListRow[],
  query: TaskListQuery = {},
): TaskListSelection {
  const matched = rows.filter((row) => {
    if (query.running && !row.isRunning) {
      return false;
    }
    if (query.since && row.updatedAt < query.since) {
      return false;
    }
    return !(query.until && row.updatedAt > query.until);
  });
  const size = query.all
    ? matched.length
    : Math.max(0, query.limit ?? TASK_LIST_WINDOW);
  const shown = matched.slice(0, size);
  return {
    omitted: matched.length - shown.length,
    shown,
    total: matched.length,
  };
}

/**
 * What the footer says when the window left rows behind. Naming every way to
 * narrow is the point of it: a listing that only says there is more invites an
 * answer drawn from the part that fit.
 */
function moreLine(
  selection: { omitted: number; total: number },
  extra = "",
): string {
  return `… ${selection.omitted} more of ${selection.total}. Narrow with --since <date> or --until <date>${extra}; --all shows every match.`;
}
