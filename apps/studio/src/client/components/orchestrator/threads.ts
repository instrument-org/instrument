import { type RPCOutput } from "@/client/rpc/client";
import { format, isSameYear } from "date-fns";

/** A thread as the chat lists it: the first message, the title, and where it stands. */
export type Thread =
  RPCOutput["workspace"]["orchestrator"]["threads"]["list"][number];

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ThreadFilters {
  /** App slugs a thread has to have used one of. */
  apps: string[];
  /** The place the column stands in, when it is not the inbox: the unread, what needs the user, the drafts, or the archive. */
  place?: ThreadPlace;
  /** Words that all have to turn up somewhere on a thread's row, whatever their case. */
  search: string;
  /** Topic ids a thread has to be filed under one of. */
  topics: string[];
}

/** The places of the column apart from the inbox: threads with replies not yet seen, threads waiting on the user, drafts not yet sent, and threads put away. */
export type ThreadPlace = "archive" | "drafts" | "needsYou" | "unread";

/** A topic as the workspace keeps it: a tag with a name, a mark, and a tint. */
export type Topic =
  RPCOutput["workspace"]["orchestrator"]["topics"]["list"][number];

export const NO_FILTERS: ThreadFilters = {
  apps: [],
  search: "",
  topics: [],
};

/** What a search reads the pills by when no topics are in hand: nothing, so a pill's name is not searched. */
const NO_TOPIC_NAMES: ReadonlyMap<string, string> = new Map();

/** The part of a thread the filters read, which is what its row shows, so the predicate is testable off any row shape. */
export interface Filterable {
  /** Whether the thread was put away: out of every place but the archive. */
  archived: boolean;
  holds: { apps: string[]; files: string[]; sites: string[] };
  latest?: { text: string };
  root: { parts: { text?: string; type: string }[] };
  state: "idle" | "waiting" | "working";
  title: string;
  topics: string[];
  unread: number;
}

/** One row of the column: which group it is in, and which of that group's ids it stands for. */
export type FilterChoice =
  | { group: "apps" | "topics"; id: string }
  | { group: "place"; id: ThreadPlace };

/** Every app slug any thread has used, in name order by whoever names them. */
export function appsUsed(threads: Filterable[]): string[] {
  return [...new Set(threads.flatMap((thread) => thread.holds.apps))];
}

/**
 * The filters with one row chosen and every other row off, or with nothing
 * chosen when the row was the one already on: the column is one radio group
 * across all of its sections, so the list is never narrowed by two kinds at
 * once, and stepping out of any row lands in the inbox. The search is its own
 * thing and stays as it was. The predicate still reads lists, so nothing
 * downstream knows the column only ever fills one.
 */
export function chooseOnly(
  filters: ThreadFilters,
  choice: FilterChoice,
): ThreadFilters {
  const cleared = { ...NO_FILTERS, search: filters.search };
  if (choice.group === "place") {
    return filters.place === choice.id
      ? cleared
      : { ...cleared, place: choice.id };
  }
  return filters[choice.group].includes(choice.id)
    ? cleared
    : { ...cleared, [choice.group]: [choice.id] };
}

/** How many of a section's rows the filter column shows before folding the rest behind a "more" row. */
export const SECTION_SHOWN = 6;

/**
 * The rows a folded section shows: the first several in their order, and any
 * chosen one past them, since a filter that is on has to stay in reach to be
 * turned off. `hidden` is how many the "more" row stands for.
 */
export function foldSection<T extends { id: string }>(
  entries: T[],
  chosen: ReadonlySet<string>,
  limit = SECTION_SHOWN,
): { hidden: number; shown: T[] } {
  const shown = entries.filter(
    (entry, index) => index < limit || chosen.has(entry.id),
  );
  return { hidden: entries.length - shown.length, shown };
}

/** Whether every word searched for turns up in what a row shows, whatever its case. Nothing searched for matches everything. */
export function hasWords(search: string, shown: string[]) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const text = shown.join("\n").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Whether the column stands in the inbox: nothing chosen, so every thread is in view. */
export function isInbox(filters: ThreadFilters) {
  return (
    filters.place === undefined &&
    filters.topics.length === 0 &&
    filters.apps.length === 0
  );
}

/** Whether a thread passes every filter that is set. */
export function matchesFilters(
  thread: Filterable,
  filters: ThreadFilters,
  /** Topic names by id, which is how the search reads a row's pills. */
  topicNames: ReadonlyMap<string, string> = NO_TOPIC_NAMES,
) {
  return (
    matchesPlace(thread, filters.place) &&
    anyOf(filters.topics, thread.topics) &&
    anyOf(filters.apps, thread.holds.apps) &&
    matchesSearch(thread, filters.search, topicNames)
  );
}

/** A group with nothing chosen narrows nothing; one with choices wants any of them. */
function anyOf<T extends string>(chosen: T[], held: T[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
}

/**
 * Whether a thread is in the place the column stands in. A thread put away
 * is in the archive and nowhere else, so the inbox is every other thread, the
 * unread those of them with replies not yet seen, and Needs you those waiting
 * on the user. Drafts are not threads at all yet, so that place holds none.
 */
function matchesPlace(thread: Filterable, place: ThreadPlace | undefined) {
  switch (place) {
    case "archive": {
      return thread.archived;
    }
    case "drafts": {
      return false;
    }
    case "needsYou": {
      return !thread.archived && thread.state === "waiting";
    }
    case undefined: {
      return !thread.archived;
    }
    case "unread": {
      return !thread.archived && thread.unread > 0;
    }
  }
}

/**
 * Whether every word searched for turns up somewhere on the thread's row,
 * whatever its case: in the title, the ask, the latest line, a topic's name,
 * a file's name, a site, or an app. Nothing searched for matches everything.
 */
function matchesSearch(
  thread: Filterable,
  search: string,
  topicNames: ReadonlyMap<string, string>,
) {
  return hasWords(search, [
    thread.title,
    askOf(thread),
    thread.latest?.text ?? "",
    ...thread.topics.map((id) => topicNames.get(id) ?? ""),
    ...thread.holds.files.map(basename),
    ...thread.holds.sites,
    ...thread.holds.apps,
  ]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When something last happened in a thread, the way a mailbox says it at a
 * row's end: the time of day while it is today, the weekday for the rest of
 * the week, and past that the date, since a weekday alone stops saying which
 * one it was.
 */
export function activityLabel(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 0) {
    return format(date, "h:mm a");
  }
  if (days < 6) {
    return format(date, "EEE");
  }
  return format(date, isSameYear(date, now) ? "MMM d" : "MMM d, yyyy");
}

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

/** The threads by when something last happened in each, newest first, which is the order the inbox keeps. */
export function byActivity<T extends { updatedAt: number }>(threads: T[]): T[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The head a day's rows sit under: today and yesterday by name, the rest of
 * the week by weekday, and past that the date, since a weekday alone stops
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

/** What a draft's row calls it: the first line of its words that says anything, or a name for one with no words yet. */
export function draftTitle(words: string): string {
  return (
    words
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "New thread"
  );
}
