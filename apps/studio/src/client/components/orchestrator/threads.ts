import { type RPCOutput } from "@/client/rpc/client";
import { format, isSameYear } from "date-fns";

/** A thread as the chat lists it: the first message, the title, and where it stands. */
export type Thread =
  RPCOutput["workspace"]["orchestrator"]["threads"]["list"][number];

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ThreadFilters {
  /** App slugs a thread has to have used one of. */
  apps: string[];
  /** Words that all have to turn up somewhere on a thread's row, whatever their case. */
  search: string;
  /** Hostnames a thread has to have been to one of. */
  sites: string[];
  /** States a thread has to be in one of. */
  status: ThreadStatus[];
  /** Topic ids a thread has to be filed under one of. */
  topics: string[];
}

/** The two states a thread can be picked out by: replies not yet seen, and a question waiting on an answer. */
export type ThreadStatus = "needsYou" | "unread";

/** A topic as the workspace keeps it: a tag with a name, a mark, and a tint. */
export type Topic =
  RPCOutput["workspace"]["orchestrator"]["topics"]["list"][number];

export const NO_FILTERS: ThreadFilters = {
  apps: [],
  search: "",
  sites: [],
  status: [],
  topics: [],
};

/** What a search reads the pills by when no topics are in hand: nothing, so a pill's name is not searched. */
const NO_TOPIC_NAMES: ReadonlyMap<string, string> = new Map();

/** The states in the order the Status menu offers them, each with its name. */
export const THREAD_STATUSES: { id: ThreadStatus; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "needsYou", label: "Needs you" },
];

/** The part of a thread the filters read, which is what its row shows, so the predicate is testable off any row shape. */
export interface Filterable {
  holds: { apps: string[]; files: string[]; sites: string[] };
  latest?: { text: string };
  root: { parts: { text?: string; type: string }[] };
  state: "idle" | "waiting" | "working";
  title: string;
  topics: string[];
  unread: number;
}

/** Every app slug any thread has used, in name order by whoever names them. */
export function appsUsed(threads: Filterable[]): string[] {
  return [...new Set(threads.flatMap((thread) => thread.holds.apps))];
}

/** Whether a thread is in a state, by the state's name. */
export function hasStatus(thread: Filterable, status: ThreadStatus) {
  return status === "unread" ? thread.unread > 0 : thread.state === "waiting";
}

/** Whether a thread passes every filter that is set. */
export function matchesFilters(
  thread: Filterable,
  filters: ThreadFilters,
  /** Topic names by id, which is how the search reads a row's pills. */
  topicNames: ReadonlyMap<string, string> = NO_TOPIC_NAMES,
) {
  return (
    anyOf(filters.status, statusesOf(thread)) &&
    anyOf(filters.topics, thread.topics) &&
    anyOf(filters.apps, thread.holds.apps) &&
    anyOf(filters.sites, thread.holds.sites) &&
    matchesSearch(thread, filters.search, topicNames)
  );
}

/**
 * Whether every word searched for turns up somewhere on the thread's row,
 * whatever its case: in the title, the ask, the latest line, a topic's name,
 * a file's name, a site, or an app. Nothing searched for matches everything.
 */
export function matchesSearch(
  thread: Filterable,
  search: string,
  topicNames: ReadonlyMap<string, string>,
) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const shown = [
    thread.title,
    askOf(thread),
    thread.latest?.text ?? "",
    ...thread.topics.map((id) => topicNames.get(id) ?? ""),
    ...thread.holds.files.map(basename),
    ...thread.holds.sites,
    ...thread.holds.apps,
  ]
    .join("\n")
    .toLowerCase();
  return words.every((word) => shown.includes(word));
}

/**
 * How often each hostname turns up across the threads, most used first, which
 * is the order the Sites menu offers them in: there can be hundreds, and the
 * ones the agent keeps going back to are the ones worth a filter.
 */
export function sitesByUse(threads: Filterable[]): string[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    for (const site of thread.holds.sites) {
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([site]) => site);
}

/** A group with nothing chosen narrows nothing; one with choices wants any of them. */
function anyOf<T extends string>(chosen: T[], held: T[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
}

/** The states a thread is in right now. */
function statusesOf(thread: Filterable): ThreadStatus[] {
  return THREAD_STATUSES.flatMap(({ id }) =>
    hasStatus(thread, id) ? [id] : [],
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The words of a thread's first message: what the row shows as the ask. */
export function askOf(thread: {
  root: { parts: { text?: string; type: string }[] };
}): string {
  return thread.root.parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
}

/** The last part of a path, which is how a file is named on a row. */
export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

/**
 * The head a day's threads sit under: today and yesterday by name, the rest
 * of the week by weekday, and past that the date, since a weekday alone stops
 * saying which one it was.
 */
export function dayLabel(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 0) {
    return "Today";
  }
  if (days < 1) {
    return "Yesterday";
  }
  if (days < 6) {
    return format(date, "EEEE");
  }
  return format(date, isSameYear(date, now) ? "MMM d" : "MMM d, yyyy");
}

/** The threads under their day heads, oldest first, so the newest sits at the foot of the list. */
export function groupByDay<T extends { createdAt: number }>(
  threads: T[],
  now: Date,
): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const thread of [...threads].sort((a, b) => a.createdAt - b.createdAt)) {
    const label = dayLabel(new Date(thread.createdAt), now);
    const last = groups.at(-1);
    if (last?.[0] === label) {
      last[1].push(thread);
    } else {
      groups.push([label, [thread]]);
    }
  }
  return groups;
}
