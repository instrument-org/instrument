import { stripDictatedMarks } from "@instrument-org/shared/dictated-text";
import { type ChatId, type ChatStatus } from "@instrument-org/workspace/client";
import { type RPCOutput } from "@/client/rpc/client";
import { placeholderTitle } from "@instrument-org/shared";
import { renderSkillMentionsAsText } from "@instrument-org/shared/skill-mention";
import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import { format } from "date-fns/format";
import { isSameYear } from "date-fns/isSameYear";

import { nameOf } from "./host-path";
import { matchScreen } from "./window-href";

/** A chat as the chat lists it: the first message, the title, and where it stands. */
export type Chat = NonNullable<RPCOutput["workspace"]["chats"]["byId"]>;

/** What narrows the list, all of it client-side: each group is any-of, and the groups are all-of. */
export interface ChatFilters {
  /** App slugs a chat has to have used one of. */
  apps: string[];
  /** The place the column stands in, when it is not the inbox: the drafts, or what was put away. */
  place?: ChatPlace;
  /** Words that all have to turn up somewhere on a chat's row, whatever their case. */
  search: string;
  /** Project ids a chat has to be filed under one of. */
  projects: string[];
  /** Marks a chat has to carry every one of, standing in the search as tokens: on top of whatever view the column is. */
  tags: ChatTag[];
}

/** The places of the column apart from the inbox: drafts not yet sent, and chats put away. */
export type ChatPlace = "archived" | "drafts";

/** The marks the search narrows by: chats holding replies not yet seen, and chats the user starred. */
export type ChatTag = "starred" | "unread";

/** A project as the workspace keeps it: a tag with a name, a mark, and a tint. */
export type Project = RPCOutput["workspace"]["projects"]["list"][number];

export const NO_FILTERS: ChatFilters = {
  apps: [],
  search: "",
  projects: [],
  tags: [],
};

/** What a search reads the pills by when no projects are in hand: nothing, so a pill's name is not searched. */
const NO_PROJECT_NAMES: ReadonlyMap<string, string> = new Map();

/** The part of a chat the filters read, which is what its row shows, so the predicate is testable off any row shape. */
export interface Filterable {
  /** Whether the chat was put away: out of every place but Archived. */
  archived: boolean;
  holds: { apps: string[]; files: string[]; sites: string[] };
  /** The words of the chat's first message. */
  firstAsk: string;
  latest?: { text: string };
  /** Whether the user starred it: a mark of the user's own, kept wherever the chat is. */
  starred: boolean;
  status: ChatStatus;
  title: string;
  /** The id of the project it is filed under, when it is filed under one. */
  project?: string;
  /** Whether it carries the unread mark: something in it not yet looked at. */
  unread: boolean;
}

/**
 * The column standing in a place: the inbox (none), Drafts or Archived, the
 * tabs under the search. A place is a view of every chat, so it leaves a
 * project or an app behind; the marks narrowing the search stay, except in
 * Drafts, where a draft carries neither.
 */
export function inPlace(
  filters: ChatFilters,
  place: ChatPlace | undefined,
): ChatFilters {
  const { place: _place, ...rest } = filters;
  return {
    ...rest,
    apps: [],
    projects: [],
    ...(place === undefined ? {} : { place }),
    tags: place === "drafts" ? [] : filters.tags,
  };
}

/**
 * The column standing in one project, or back in the inbox for the one it
 * already stands in. The project is the whole of its collection, so the
 * place is left; the marks narrowing the search and the search stay.
 */
export function inProject(filters: ChatFilters, id: string): ChatFilters {
  const { place: _place, ...rest } = filters;
  return {
    ...rest,
    apps: [],
    projects: filters.projects.includes(id) ? [] : [id],
  };
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

/**
 * Where the words searched for turn up in a line a row shows, as the flat
 * start and end pairs a highlight draws, in order and with overlaps joined:
 * every place each word appears, whatever its case. Null when none do.
 */
export function wordRanges(text: string, search: string): null | number[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const found: [number, number][] = [];
  for (const word of words) {
    for (
      let at = lower.indexOf(word);
      at !== -1;
      at = lower.indexOf(word, at + word.length)
    ) {
      found.push([at, at + word.length]);
    }
  }
  if (found.length === 0) {
    return null;
  }
  found.sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [start, end] of found) {
    const last = joined.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      joined.push([start, end]);
    }
  }
  return joined.flat();
}

/**
 * What a search of the command menu asks of the projects: whether it names
 * them outright, with "project" or "projects" as a word of its own anywhere in
 * it, and the words left to find one by its name. So "project reading" and
 * "reading project" both look for Reading, and the word alone, which leaves no
 * name, asks for every project. A search that never says the word is all name.
 */
export function projectSearch(words: string): {
  isAsked: boolean;
  name: string;
} {
  const terms = words.trim().split(/\s+/).filter(Boolean);
  const at = terms.findIndex((term) => /^projects?:?$/i.test(term));
  return {
    isAsked: at !== -1,
    name: terms.filter((_, index) => index !== at).join(" "),
  };
}

/** Whether a chat passes every filter that is set. */
export function matchesFilters(
  chat: Filterable,
  filters: ChatFilters,
  /** Project names by id, which is how the search reads a row's pills. */
  projectNames: ReadonlyMap<string, string> = NO_PROJECT_NAMES,
) {
  return (
    matchesPlace(chat, filters) &&
    filters.tags.every((tag) => chat[tag]) &&
    anyOf(filters.projects, chat.project ? [chat.project] : []) &&
    anyOf(filters.apps, chat.holds.apps) &&
    matchesSearch(chat, filters.search, projectNames)
  );
}

/**
 * The chats the words searched for turn up on that the place, project, or
 * app filter keeps out of the list. A search reads inside the place the
 * column stands in, so a match filed elsewhere would be silently missing;
 * the list counts these at its end and shows them under it when asked.
 * Nothing searched for means nothing is missing, whatever the filters hide.
 */
export function outsideFilters<T extends Filterable>(
  chats: T[],
  filters: ChatFilters,
  projectNames: ReadonlyMap<string, string> = NO_PROJECT_NAMES,
): T[] {
  if (filters.search.trim() === "") {
    return [];
  }
  return chats.filter(
    (chat) =>
      matchesSearch(chat, filters.search, projectNames) &&
      !matchesFilters(chat, filters, projectNames),
  );
}

/** A group with nothing chosen narrows nothing; one with choices wants any of them. */
function anyOf<T extends string>(chosen: T[], held: T[]) {
  return chosen.length === 0 || chosen.some((entry) => held.includes(entry));
}

/**
 * Whether a chat is in the place the column stands in. A chat put away
 * is in Archived alone, the way mail keeps what was archived out of the
 * inbox, so the inbox is every other chat, and a project chosen there shows
 * what is filed under it and not put away. A search finds the ones put away
 * through the matches outside the filters. Drafts are not chats at all yet,
 * so that place holds none.
 */
function matchesPlace(chat: Filterable, filters: ChatFilters) {
  switch (filters.place) {
    case "archived": {
      return chat.archived;
    }
    case "drafts": {
      return false;
    }
    case undefined: {
      return !chat.archived;
    }
  }
}

/**
 * Whether every word searched for turns up somewhere on the chat's row,
 * whatever its case: in the title, the ask, the latest line, a project's name,
 * a file's name, a site, or an app. Nothing searched for matches everything.
 */
function matchesSearch(
  chat: Filterable,
  search: string,
  projectNames: ReadonlyMap<string, string>,
) {
  return hasWords(search, [
    chat.title,
    chat.firstAsk,
    chat.latest?.text ?? "",
    chat.project ? (projectNames.get(chat.project) ?? "") : "",
    ...chat.holds.files.map(nameOf),
    ...chat.holds.sites,
    ...chat.holds.apps,
  ]);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Said once a usage limit stopped the chat's last turn, which is not an error:
 * the note over its reply box says what to do.
 */
const LIMITED = "Stopped at a usage limit";

/**
 * Said once Instrument refused the chat's last turn for want of a plan or a
 * trial: not a limit reached, and the reply box's note says what unlocks it.
 */
const PLAN_NEEDED = "Stopped: needs a plan";

/** Said once Instrument refused the turn because the plan's last payment failed. */
const PAYMENT_FAILED = "Stopped: payment didn't go through";

/** What a stopped-at-a-limit chat says, by what stopped it. */
export function limitedText(chat: Pick<Chat, "stoppedFor">) {
  switch (chat.stoppedFor) {
    case "payment":
      return PAYMENT_FAILED;
    case "plan":
      return PLAN_NEEDED;
    default:
      return LIMITED;
  }
}

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

/** Items by when something last happened in each, newest first. */
export function byActivity<T extends { updatedAt: number }>(chats: T[]): T[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * What a draft's row calls it: the first line of its words that says
 * anything, read as a person reads it (a skill as `/name`, an app or a page
 * by the name it was given, no Markdown marks), or a name for one with no
 * words yet.
 */
export function draftTitle(words: string): string {
  return placeholderTitle(
    stripMarkdown(stripDictatedMarks(renderSkillMentionsAsText(words)))
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "New chat",
  );
}

/**
 * A chat whose first message is on its way, as its head shows it: named by
 * the words sent and filed under the project they were sent under until its
 * record has the message, so the head reads from the press as it will once
 * the chat has started.
 */
export function chatAsSent(
  chat: Chat,
  sent: { project: string | undefined; words: string },
): Chat {
  if (chat.firstAsk !== "") {
    return chat;
  }
  return {
    ...chat,
    // With no message there is nothing the chat could be named by yet.
    title: draftTitle(sent.words),
    ...(chat.project === undefined && sent.project !== undefined
      ? { project: sent.project }
      : {}),
  };
}

/** The dot the rail's Chat entry wears while the window stands elsewhere. */
export type RailChatMark = "unread" | "waiting" | "working";

/**
 * Which dot the rail's Chat entry wears for these chats: amber while any
 * waits on the user, since a question outranks work, the working pulse
 * while any works, and green while any has something not yet seen. A chat
 * put away counts for none of it, as it is out of the inbox.
 */
export function railMarkOf(
  chats: readonly {
    archived: boolean;
    status: Filterable["status"];
    unread: boolean;
    working: boolean;
  }[],
): RailChatMark | undefined {
  const inbox = chats.filter((chat) => !chat.archived);
  if (inbox.some((chat) => chat.status === "waiting")) {
    return "waiting";
  }
  if (inbox.some((chat) => chat.working)) {
    return "working";
  }
  return inbox.some((chat) => chat.unread) ? "unread" : undefined;
}

/** The dot the rail wears for chats by the marks each wears alone: what `railMarkOf` says of them all together. */
export function strongestMark(
  marks: Iterable<RailChatMark>,
): RailChatMark | undefined {
  const worn = new Set(marks);
  return (["waiting", "working", "unread"] as const).find((mark) =>
    worn.has(mark),
  );
}

/**
 * What one chat wears where it stands outside the chat itself, in its window
 * tab or its bar along the foot: its title shimmers while it works, and the
 * rail's dot sits on its icon for a reply not yet seen or a question waiting,
 * except where the chat is up, which is the chat on screen.
 */
export function chatMarkShown(
  mark: RailChatMark | undefined,
  { isUp }: { isUp: boolean },
): { dot?: "unread" | "waiting"; isWorking: boolean } {
  return {
    ...(!isUp && (mark === "unread" || mark === "waiting")
      ? { dot: mark }
      : {}),
    isWorking: mark === "working",
  };
}

/** What a window tab standing at `href` wears for its chat (`chatMarkShown`). */
export function chatTabMark(
  href: string,
  chatMarks: ReadonlyMap<ChatId, RailChatMark>,
  { isUp }: { isUp: boolean },
): { dot?: "unread" | "waiting"; isWorking: boolean } {
  const screen = matchScreen(href);
  return chatMarkShown(
    screen.kind === "chat" ? chatMarks.get(screen.chat) : undefined,
    { isUp },
  );
}

/** Chats by when the user last messaged them, newest first. */
export function byLastUserMessage<T extends { lastUserMessageAt: number }>(
  chats: T[],
): T[] {
  return [...chats].sort((a, b) => b.lastUserMessageAt - a.lastUserMessageAt);
}

/**
 * The projects as the list shows them: the one with the newest chat first,
 * so the project just worked in is never the one folded away, and a project
 * with no chats yet by when it was made, newest first, after them.
 */
export function byNewestChat<
  P extends { created: Date | number | string; id: string },
>(
  projects: P[],
  chats: { lastUserMessageAt: number; project?: string }[],
): P[] {
  const newest = new Map<string, number>();
  for (const chat of chats) {
    if (chat.project !== undefined) {
      newest.set(
        chat.project,
        Math.max(newest.get(chat.project) ?? 0, chat.lastUserMessageAt),
      );
    }
  }
  const made = (project: P) => new Date(project.created).getTime();
  return [...projects].sort(
    (a, b) =>
      (newest.get(b.id) ?? 0) - (newest.get(a.id) ?? 0) || made(b) - made(a),
  );
}

/**
 * The heading of the day a moment falls on, as a list grouped by day says
 * it: Today, Yesterday, the weekday within the week, and the date past that.
 */
export function dayHeading(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfDay = new Date(date).setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday - startOfDay) / DAY_MS);
  if (days <= 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  if (days < 7) {
    return format(date, "EEEE");
  }
  return format(date, isSameYear(date, now) ? "MMMM d" : "MMMM d, yyyy");
}
