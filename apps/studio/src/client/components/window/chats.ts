import { type RPCOutput } from "@/client/rpc/client";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { format, isSameYear } from "date-fns";

/** A chat as the chat lists it: the first message, the title, and where it stands. */
export type Chat = NonNullable<RPCOutput["workspace"]["chats"]["byId"]>;

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ChatFilters {
  /** App slugs a chat has to have used one of. */
  apps: string[];
  /** The place the column stands in, when it is not the inbox: what needs the user, the starred, the drafts, or all of it. */
  place?: ChatPlace;
  /** Words that all have to turn up somewhere on a chat's row, whatever their case. */
  search: string;
  /** Topic ids a chat has to be filed under one of. */
  topics: string[];
}

/** The places of the column apart from the inbox: chats waiting on the user, chats the user starred, drafts not yet sent, and every chat, the ones put away among them. What is unread is a count on a place, the way mail counts it, rather than a place of its own. */
export type ChatPlace = "all" | "drafts" | "needsYou" | "starred";

/** A topic as the workspace keeps it: a tag with a name, a mark, and a tint. */
export type Topic = RPCOutput["workspace"]["topics"]["list"][number];

export const NO_FILTERS: ChatFilters = {
  apps: [],
  search: "",
  topics: [],
};

/** What a search reads the pills by when no topics are in hand: nothing, so a pill's name is not searched. */
const NO_TOPIC_NAMES: ReadonlyMap<string, string> = new Map();

/** The part of a chat the filters read, which is what its row shows, so the predicate is testable off any row shape. */
export interface Filterable {
  /** Whether the chat was put away: out of every place but All. */
  archived: boolean;
  holds: { apps: string[]; files: string[]; sites: string[] };
  latest?: { text: string };
  root?: undefined | { parts: { text?: string; type: string }[] };
  /** Whether the user starred it: a mark of the user's own, kept wherever the chat is. */
  starred: boolean;
  state: "idle" | "waiting" | "working";
  title: string;
  topics: string[];
  unread: number;
}

/** One row of the column: which group it is in, and which of that group's ids it stands for. */
export type FilterChoice =
  | { group: "apps" | "topics"; id: string }
  | { group: "place"; id: ChatPlace };

/**
 * The filters with a row turned. The column shows one view at a time: the
 * inbox, one topic, one app, or one place (what needs the user, the
 * starred, the drafts, all of it), so choosing any of them leaves the others
 * and choosing the one already on steps back to the inbox. The search is its
 * own thing and stays as it was. The predicate still reads lists, so nothing
 * downstream knows the column only ever fills one.
 */
export function choose(
  filters: ChatFilters,
  choice: FilterChoice,
): ChatFilters {
  const { place: _place, ...rest } = filters;
  const inbox = { ...rest, apps: [], topics: [] };
  if (choice.group === "place") {
    return filters.place === choice.id ? inbox : { ...inbox, place: choice.id };
  }
  return filters[choice.group].includes(choice.id)
    ? inbox
    : { ...inbox, [choice.group]: [choice.id] };
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

/** Whether the column stands in the inbox: no place chosen, whatever topic or app narrows it. */
export function isInbox(filters: ChatFilters) {
  return filters.place === undefined;
}

/** Whether a chat passes every filter that is set. */
export function matchesFilters(
  chat: Filterable,
  filters: ChatFilters,
  /** Topic names by id, which is how the search reads a row's pills. */
  topicNames: ReadonlyMap<string, string> = NO_TOPIC_NAMES,
) {
  return (
    matchesPlace(chat, filters) &&
    anyOf(filters.topics, chat.topics) &&
    anyOf(filters.apps, chat.holds.apps) &&
    matchesSearch(chat, filters.search, topicNames)
  );
}

/**
 * How many chats the words searched for turn up on that the place, topic,
 * or app filter keeps out of the list. A search reads inside the place the
 * column stands in, so a match filed elsewhere is silently missing; this is
 * the count the list says so with. Nothing searched for means nothing is
 * missing, whatever the filters hide.
 */
export function outsideFilters(
  chats: Filterable[],
  filters: ChatFilters,
  topicNames: ReadonlyMap<string, string> = NO_TOPIC_NAMES,
) {
  if (filters.search.trim() === "") {
    return 0;
  }
  return chats.filter(
    (chat) =>
      matchesSearch(chat, filters.search, topicNames) &&
      !matchesFilters(chat, filters, topicNames),
  ).length;
}

/** The same search over every chat: the words kept, the place, topic, and app filters lifted. */
export function widenToSearch(filters: ChatFilters): ChatFilters {
  return { ...filters, apps: [], place: "all", topics: [] };
}

/** A group with nothing chosen narrows nothing; one with choices wants any of them. */
function anyOf<T extends string>(chosen: T[], held: T[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
}

/**
 * Whether a chat is in the place the column stands in. A chat put away
 * is in All and nowhere else, the way mail keeps what was archived out of
 * the inbox but in the whole of it, so the inbox is every other chat and
 * Needs you those of them waiting on the user. A topic is a label rather
 * than a place, so one chosen shows what is filed under it, put away or
 * not. Drafts are not chats at all yet, so that place holds none.
 */
function matchesPlace(chat: Filterable, filters: ChatFilters) {
  switch (filters.place) {
    case "all": {
      return true;
    }
    case "drafts": {
      return false;
    }
    case "needsYou": {
      return !chat.archived && chat.state === "waiting";
    }
    case "starred": {
      // A star is the user's own mark, and stays on a chat put away.
      return chat.starred;
    }
    case undefined: {
      return !chat.archived || filters.topics.length > 0;
    }
  }
}

/**
 * Whether every word searched for turns up somewhere on the chat's row,
 * whatever its case: in the title, the ask, the latest line, a topic's name,
 * a file's name, a site, or an app. Nothing searched for matches everything.
 */
function matchesSearch(
  chat: Filterable,
  search: string,
  topicNames: ReadonlyMap<string, string>,
) {
  return hasWords(search, [
    chat.title,
    askOf(chat),
    chat.latest?.text ?? "",
    ...chat.topics.map((id) => topicNames.get(id) ?? ""),
    ...chat.holds.files.map(basename),
    ...chat.holds.sites,
    ...chat.holds.apps,
  ]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When something last happened in a chat, the way a mailbox says it at a
 * row's end: the time of day while it is today, and the date past that.
 */
export function activityLabel(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 0) {
    return format(date, "h:mm a");
  }
  return format(date, isSameYear(date, now) ? "MMM d" : "MMM d, yyyy");
}

/** The words of a chat's first message: what the row shows as the ask. */
export function askOf(chat: {
  root?: undefined | { parts: { text?: string; type: string }[] };
}): string {
  return (chat.root?.parts ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
}

/** The last part of a path, which is how a file is named on a row. */
export function basename(path: string): string {
  return path.replace(/\/+$/, "").split("/").at(-1) || path;
}

/** The chats by when something last happened in each, newest first, which is the order the inbox keeps. */
export function byActivity<T extends { updatedAt: number }>(chats: T[]): T[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
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

/**
 * What a draft's row calls it: the first line of its words that says
 * anything, read as a person reads it (a skill as `/name`, an app or a page
 * by the name it was given, no Markdown marks), or a name for one with no
 * words yet.
 */
export function draftTitle(words: string): string {
  return (
    stripMarkdown(renderSkillMentionsAsText(words))
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "New chat"
  );
}
