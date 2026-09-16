import {
  type OrchestratorRecent,
  type VisitedPage,
} from "@/client/atoms/orchestrator";
import { type OpenTarget } from "@/client/lib/open-target";
import { type RPCOutput } from "@/client/rpc/client";

import { folderOf, segmentsOf } from "./host-path";
import { ACTIVITY_HREF, THREADS_HREF } from "./screen-presentation";
import { dayLabel } from "./threads";
import { parseHref } from "./window-tabs";

/** One thing that happened in a thread, as the workspace read it out of the thread's messages. */
export type ActivityEntry =
  RPCOutput["workspace"]["orchestrator"]["activityLog"]["list"][number];

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ActivityFilters {
  /** App slugs an entry has to have used one of. */
  apps: string[];
  /** Hostnames an entry has to have opened one of, or a visit been to. */
  sites: string[];
  /** Topic ids an entry's thread has to be filed under one of. */
  topics: string[];
  /** Whose side of the record: both, Instrument's alone, or the user's alone. */
  who: ActivityWho;
}

/**
 * What sits under a day head: a thread's entries from that day as one group
 * under the thread's name, or a run of the window's visits, which is in no
 * thread and sits among the groups by its time.
 */
export type ActivityItem =
  | Extract<ActivityRow, { kind: "looked" }>
  | ThreadGroup;

/**
 * One line of Activity: an entry from a thread, or a run of the window's own
 * visits, which the workspace never sees and the window merges in itself.
 */
export type ActivityRow =
  | { at: number; entry: ActivityEntry; id: string; kind: "entry" }
  | { at: number; id: string; kind: "looked"; visits: Visit[] };

/**
 * The two sides of the record. The user's is what they asked and what the
 * window showed them; Instrument's is everything the threads did in answer.
 */
export type ActivityWho = "all" | "instrument" | "you";

/**
 * A thread's entries within one day, newest first, headed by the thread as
 * its newest entry names it and placed by that entry's time.
 */
export interface ThreadGroup {
  at: number;
  id: string;
  kind: "thread";
  rows: Extract<ActivityRow, { kind: "entry" }>[];
  thread: ActivityEntry["thread"];
}

/** One thing the window showed the user: a screen by its address, or a page by its url. */
export interface Visit {
  at: number;
  favicon?: string;
  /** For a file, the folder it sits in, so a run of files can say where they were. */
  folder?: string;
  kind: "file" | "folder" | "page" | "task";
  /** What opens it again. */
  target: OpenTarget;
  title: string;
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = {
  apps: [],
  sites: [],
  topics: [],
  who: "all",
};

/** How far apart two visits can be and still be one run. */
const VISIT_RUN_MS = 10 * 60 * 1000;

/** Every app slug the entries used, in first-seen order. */
export function appsIn(rows: ActivityRow[]): string[] {
  return [
    ...new Set(
      rows.flatMap((row) =>
        row.kind === "entry" ? (row.entry.marks?.apps ?? []) : [],
      ),
    ),
  ];
}

/**
 * The window's visits as rows, newest first, each run of them within ten
 * minutes of the last collapsed into one: a person clicking down through a
 * folder is one thing they did, and twelve lines for it would bury what the
 * threads did in between.
 */
export function collapseVisits(visits: Visit[]): ActivityRow[] {
  const runs: Visit[][] = [];
  for (const visit of [...visits].sort((a, b) => b.at - a.at)) {
    const run = runs.at(-1);
    const oldest = run?.at(-1);
    if (run && oldest && oldest.at - visit.at <= VISIT_RUN_MS) {
      run.push(visit);
    } else {
      runs.push([visit]);
    }
  }
  return runs.flatMap((run): ActivityRow[] => {
    const [newest] = run;
    const oldest = run.at(-1);
    if (!newest || !oldest) {
      return [];
    }
    return [
      {
        at: newest.at,
        // Keyed by the visit the run started with, which is the end that
        // holds still as newer visits join it.
        id: `looked:${oldest.at}:${targetKey(oldest.target)}`,
        kind: "looked",
        visits: run,
      },
    ];
  });
}

/**
 * The rows under their day heads, newest first, so today sits at the top, and
 * within a day gathered by thread: a thread's entries that day are one group
 * where its newest entry falls, so the day reads as what each thread did rather
 * than as one interleaved clock. A run of visits is in no thread and stays
 * where its time puts it. A thread with entries on two days is a group under
 * each, since a day head says what happened that day.
 */
export function groupRowsByDay(
  rows: ActivityRow[],
  now: Date,
): [string, ActivityItem[]][] {
  const days: [string, ActivityItem[]][] = [];
  // The open groups of the day being built, by thread; the day boundary drops them.
  let groups = new Map<string, ThreadGroup>();
  for (const row of rows) {
    const label = dayLabel(new Date(row.at), now);
    let day = days.at(-1);
    if (day?.[0] !== label) {
      day = [label, []];
      days.push(day);
      groups = new Map();
    }
    if (row.kind === "looked") {
      day[1].push(row);
      continue;
    }
    const group = groups.get(row.entry.thread.id);
    if (group) {
      group.rows.push(row);
      continue;
    }
    // Rows come newest first, so the first of a thread's is its newest, and
    // the group takes its place and time.
    const opened: ThreadGroup = {
      at: row.at,
      id: `thread:${row.entry.thread.id}`,
      kind: "thread",
      rows: [row],
      thread: row.entry.thread,
    };
    groups.set(row.entry.thread.id, opened);
    day[1].push(opened);
  }
  return days;
}

/**
 * What a run of visits says it was: one thing by name, or the count by kind,
 * and where the files were when they were all in one folder.
 */
export function lookedText(visits: Visit[]): string {
  const [only] = visits;
  if (visits.length === 1 && only) {
    return only.title;
  }
  const files = visits.filter((visit) => visit.kind === "file");
  const counts = [
    count(files.length, "file"),
    count(visits.filter((visit) => visit.kind === "folder").length, "folder"),
    count(visits.filter((visit) => visit.kind === "page").length, "page"),
    count(visits.filter((visit) => visit.kind === "task").length, "task"),
  ].filter((part) => part !== "");
  const folders = new Set(files.map((file) => file.folder));
  const [folder] = folders;
  const where =
    files.length === visits.length && folders.size === 1 && folder
      ? ` in ${segmentsOf(folder).at(-1) ?? folder}`
      : "";
  return `${listOf(counts)}${where}`;
}

/** Whether a row passes every filter that is set. */
export function matchesActivityFilters(
  row: ActivityRow,
  filters: ActivityFilters,
): boolean {
  if (filters.who !== "all" && isYours(row) !== (filters.who === "you")) {
    return false;
  }
  const entry = row.kind === "entry" ? row.entry : undefined;
  return (
    anyOf(filters.topics, entry?.thread.topics ?? []) &&
    anyOf(filters.apps, entry?.marks?.apps ?? []) &&
    anyOf(filters.sites, sitesOf(row))
  );
}

/** The threads' entries and the window's visits as one list, newest first. */
export function mergeRows(
  entries: ActivityEntry[],
  visits: Visit[],
): ActivityRow[] {
  const rows: ActivityRow[] = [
    ...entries.map(
      (entry): ActivityRow => ({
        at: entry.at,
        entry,
        id: entry.id,
        kind: "entry",
      }),
    ),
    ...collapseVisits(visits),
  ];
  // Stable, so entries keep the workspace's order among equals.
  return rows.sort((a, b) => b.at - a.at);
}

/** Where a row is a door to: the entry's task when it has one, else its thread; a run's newest visit. */
export function rowTarget(row: ActivityRow): OpenTarget | undefined {
  if (row.kind === "looked") {
    return row.visits[0]?.target;
  }
  const { entry } = row;
  return {
    href: entry.taskId
      ? `/orchestrator/tasks/${entry.taskId}`
      : `${THREADS_HREF}/${entry.thread.id}`,
    kind: "screen",
  };
}

/**
 * How often each hostname turns up, most used first, which is the order the
 * Sites menu offers them in.
 */
export function sitesByUse(rows: ActivityRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const site of sitesOf(row)) {
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([site]) => site);
}

/** What tells one target from another: the address it opens. */
export function targetKey(target: OpenTarget) {
  switch (target.kind) {
    case "page": {
      return target.url;
    }
    case "path": {
      return target.path;
    }
    case "screen": {
      return target.href;
    }
  }
}

/**
 * The window's own visits: the screens it recorded as recents, and the pages
 * its browser showed. Activity's own screen is left out, since looking at
 * the list is not something the list should say.
 */
export function visitsOf(
  recents: OrchestratorRecent[],
  pages: VisitedPage[],
): Visit[] {
  const screens = recents.flatMap((recent): Visit[] => {
    if (recent.kind === "browser") {
      return [
        {
          at: recent.at,
          ...(recent.favicon ? { favicon: recent.favicon } : {}),
          kind: "page",
          target: { kind: "page", url: recent.href },
          title: recent.title,
        },
      ];
    }
    const { pathname, search } = parseHref(recent.href);
    if (pathname === ACTIVITY_HREF) {
      return [];
    }
    const file = search.get("file");
    return [
      {
        at: recent.at,
        ...(recent.kind === "file" && file ? { folder: folderOf(file) } : {}),
        kind: recent.kind,
        target: { href: recent.href, kind: "screen" },
        title: recent.title,
      },
    ];
  });
  const visited = pages.map(
    (page): Visit => ({
      at: page.at,
      ...(page.favicon ? { favicon: page.favicon } : {}),
      kind: "page",
      target: { kind: "page", url: page.url },
      title: page.title || hostOf(page.url) || page.url,
    }),
  );
  return [...screens, ...visited];
}

/** A group with nothing chosen narrows nothing; one with choices wants any of them. */
function anyOf(chosen: string[], held: string[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
}

function count(n: number, noun: string) {
  return n === 0 ? "" : n === 1 ? `a ${noun}` : `${n} ${noun}s`;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** The user's side of the list: what they asked, and what they looked at. */
function isYours(row: ActivityRow) {
  return row.kind === "looked" || row.entry.kind === "asked";
}

/** "a file", "a file and a page", "3 files, a page, and a task". */
function listOf(parts: string[]) {
  const last = parts.at(-1) ?? "";
  if (parts.length <= 1) {
    return last;
  }
  if (parts.length === 2) {
    return `${parts[0] ?? ""} and ${last}`;
  }
  return `${parts.slice(0, -1).join(", ")}, and ${last}`;
}

/** The hostnames a row is about: what an entry opened, or the pages a run showed. */
function sitesOf(row: ActivityRow): string[] {
  if (row.kind === "entry") {
    return row.entry.marks?.sites ?? [];
  }
  return row.visits.flatMap((visit) =>
    visit.target.kind === "page" ? (hostOf(visit.target.url) ?? []) : [],
  );
}
