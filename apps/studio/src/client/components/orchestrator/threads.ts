import { type RPCOutput } from "@/client/rpc/client";
import { format, isSameYear } from "date-fns";

/** A thread as the chat lists it: the first message, the title, and where it stands. */
export type Thread =
  RPCOutput["workspace"]["orchestrator"]["threads"]["list"][number];

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ThreadFilters {
  /** App slugs a thread has to have used one of. */
  apps: string[];
  needsYou: boolean;
  /** Hostnames a thread has to have been to one of. */
  sites: string[];
  /** Topic ids a thread has to be filed under one of. */
  topics: string[];
  unread: boolean;
}

/** A topic as the workspace keeps it: a tag with a name, a mark, and a tint. */
export type Topic =
  RPCOutput["workspace"]["orchestrator"]["topics"]["list"][number];

export const NO_FILTERS: ThreadFilters = {
  apps: [],
  needsYou: false,
  sites: [],
  topics: [],
  unread: false,
};

/** The part of a thread the filters read, so the predicate is testable off any row shape. */
export interface Filterable {
  holds: { apps: string[]; sites: string[] };
  state: "idle" | "waiting" | "working";
  topics: string[];
  unread: number;
}

/** Every app slug any thread has used, in name order by whoever names them. */
export function appsUsed(threads: Filterable[]): string[] {
  return [...new Set(threads.flatMap((thread) => thread.holds.apps))];
}

export function isUnread(thread: Filterable) {
  return thread.unread > 0;
}

/** Whether a thread passes every filter that is set. */
export function matchesFilters(thread: Filterable, filters: ThreadFilters) {
  if (filters.unread && !isUnread(thread)) {
    return false;
  }
  if (filters.needsYou && !needsYou(thread)) {
    return false;
  }
  return (
    anyOf(filters.topics, thread.topics) &&
    anyOf(filters.apps, thread.holds.apps) &&
    anyOf(filters.sites, thread.holds.sites)
  );
}

export function needsYou(thread: Filterable) {
  return thread.state === "waiting";
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
function anyOf(chosen: string[], held: string[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
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
