import { folderOf, nameOf } from "@/client/components/window/host-path";
import { chatHref } from "@/client/components/window/window-href";
import { isWebPage, type OpenTarget } from "@/client/lib/open-target";
// Types alone: the client opens its channel to the main process on import.
import type { RPCInput, RPCOutput } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { APP_NAME } from "@instrument-org/shared";
import { ChatIdSchema, gatherTurns } from "@instrument-org/workspace/client";

/**
 * Settings › Activity as data: what the person did and the AI requests the
 * app made, read from two logs a page at a time, put in one list newest
 * first, with each chat turn's requests gathered into one row, and the words
 * each row shows.
 */

/** One AI request, with its chat's title, which is null once the chat is gone. */
export type ActivityRequest =
  RPCOutput["workspace"]["activity"]["list"][number];

/** One thing the person did, as the action log has it. */
export type PersonAction = RPCOutput["actions"]["list"]["actions"][number];

/**
 * An action the list shows. A `capped` line says where the log stopped
 * writing, which is not something the person did.
 */
export type ShownAction = Exclude<PersonAction, { kind: "capped" }>;

/** Which of the two logs the list shows: both, the person's, or the AI's. */
export type ActivityView = RPCInput["activity"]["saveCsv"]["view"];

/** The requests one chat turn made, newest first. */
export type Turn = {
  /** The newest request's id, which stays the turn's as older pages add to it. */
  id: string;
  requests: ActivityRequest[];
};

export type TimelineEntry =
  | { action: ShownAction; at: number; id: string; kind: "action" }
  | { at: number; id: string; kind: "turn"; turn: Turn };

export type TimelineItem =
  | TimelineEntry
  | { id: string; kind: "day"; label: string };

/** What one log has loaded so far, newest first, and whether that is all of it. */
type Loaded<T> = { complete: boolean; items: readonly T[] };

type Source = "actions" | "requests";

const NOTHING = { complete: true, items: [] };

/** The oldest time a log has loaded, or where it is complete, nothing holding the list back. */
function reachOf(complete: boolean, times: readonly number[]) {
  if (complete) {
    return -Infinity;
  }
  return times.length === 0
    ? Infinity
    : times.reduce((oldest, at) => Math.min(oldest, at));
}

function isShown(action: PersonAction): action is ShownAction {
  return action.kind !== "capped";
}

/**
 * The list `view` shows from what both logs have loaded, and the logs whose
 * next page it waits on.
 *
 * Each log is read newest first a page at a time, so the list goes back
 * only as far as the log that has loaded least far: past that, the other
 * log may have entries not read yet that belong in between. The logs that
 * stop it there are the ones to read next.
 *
 * The requests gather into turns by `gatherTurns`, the rule
 * `instrument activity` reads them by too.
 */
export function timelineOf({
  actions,
  requests,
  view,
}: {
  actions: Loaded<PersonAction>;
  requests: Loaded<ActivityRequest>;
  view: ActivityView;
}): { entries: TimelineEntry[]; waitingOn: Source[] } {
  const mine = view === "ai" ? NOTHING : actions;
  const theirs = view === "yours" ? NOTHING : requests;
  const actionTimes = mine.items.map((action) => Date.parse(action.at));
  const reach = {
    actions: reachOf(mine.complete, actionTimes),
    requests: reachOf(
      theirs.complete,
      theirs.items.map((request) => request.startedAt),
    ),
  };
  const shownFrom = Math.max(reach.actions, reach.requests);

  // Two actions in the same millisecond are told apart by their order in the
  // log, which a later page never changes.
  const seen = new Map<string, number>();
  const merged = [
    ...mine.items.flatMap((action, index) => {
      const nth = seen.get(action.at) ?? 0;
      seen.set(action.at, nth + 1);
      const at = actionTimes[index] ?? 0;
      return isShown(action) && at >= shownFrom
        ? [{ action: { action, id: `${action.at}#${nth}` }, at }]
        : [];
    }),
    ...theirs.items.flatMap((request) =>
      request.startedAt >= shownFrom
        ? [{ at: request.startedAt, request }]
        : [],
    ),
  ].toSorted((a, b) => b.at - a.at);

  const entries = gatherTurns(merged).map((entry): TimelineEntry => {
    if (entry.kind === "action") {
      return { ...entry.action, at: entry.at, kind: "action" };
    }
    const id = entry.requests[0]?.id ?? "";
    return {
      at: entry.at,
      id,
      kind: "turn",
      turn: { id, requests: entry.requests },
    };
  });

  const waitingOn = (["actions", "requests"] as const).filter(
    (source) => reach[source] !== -Infinity && reach[source] === shownFrom,
  );
  return { entries, waitingOn };
}

/**
 * A day's head as the list writes it: its weekday and date, with the year
 * only when it is not this one, after Today or Yesterday for those two.
 */
export function dayLabel(at: number, now: Date, locale: string): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day = new Date(at);
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(day);
  if (at >= today.getTime()) {
    return `Today · ${date}`;
  }
  if (at >= yesterday.getTime()) {
    return `Yesterday · ${date}`;
  }
  return date;
}

/** The list with a head over each day's first entry. */
export function withDayHeads(
  entries: readonly TimelineEntry[],
  now: Date,
  locale: string,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let last: string | undefined;
  for (const entry of entries) {
    const label = dayLabel(entry.at, now, locale);
    if (label !== last) {
      items.push({ id: `day:${label}`, kind: "day", label });
      last = label;
    }
    items.push(entry);
  }
  return items;
}

/** A row's one line: what it names, then the muted words after it. */
export type RowText = { context: string; title: string };

/** The words of the system the rows are read on: where a deleted file waits. */
export type Words = { trash: string };

/** One name, or the first and how many more. */
const namesOf = (paths: readonly string[]) => {
  const [first] = paths;
  if (first === undefined) {
    return "";
  }
  return paths.length === 1
    ? nameOf(first)
    : `${nameOf(first)} and ${paths.length - 1} more`;
};

/** A page's site as a person reads it: `irs.gov`. */
function siteOf(url: string) {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/** A page's address without its scheme: `irs.gov/refunds`. */
function shortAddress(url: string) {
  const parsed = URL.parse(url);
  if (!parsed) {
    return url;
  }
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.hostname.replace(/^www\./, "")}${path}`;
}

/** What a row of the person's own names, and what they did with it. */
export function actionText(action: ShownAction, words: Words): RowText {
  switch (action.kind) {
    case "folder":
    case "file": {
      return { context: "", title: nameOf(action.path) };
    }
    case "open-with": {
      return {
        context: `Opened in ${action.app ?? "another app"}`,
        title: nameOf(action.path),
      };
    }
    case "edit": {
      return { context: "Edited", title: nameOf(action.path) };
    }
    case "move":
    case "copy": {
      return {
        context: `${action.kind === "move" ? "Moved" : "Copied"} to ${nameOf(action.to)}`,
        title: namesOf(action.names),
      };
    }
    case "rename": {
      return {
        context: `Renamed from ${nameOf(action.from)}`,
        title: nameOf(action.to),
      };
    }
    case "trash": {
      return {
        context: `Moved to the ${words.trash}`,
        title: namesOf(action.paths),
      };
    }
    case "new-folder": {
      return { context: "New folder", title: nameOf(action.path) };
    }
    case "chat": {
      return { context: "Chat", title: action.title };
    }
    case "page": {
      return {
        context: siteOf(action.url),
        title: action.title || shortAddress(action.url),
      };
    }
    case "download": {
      return {
        context: action.url
          ? `Downloaded from ${siteOf(action.url)}`
          : "Downloaded",
        title: nameOf(action.path),
      };
    }
    case "app": {
      return {
        context:
          action.did === "signed in"
            ? "Signed in"
            : action.did === "disconnected"
              ? "Disconnected"
              : "Couldn't sign in",
        title: action.name,
      };
    }
    case "update": {
      return { context: "Updated", title: `${APP_NAME} ${action.to}` };
    }
    case "permission": {
      return {
        context: `${action.did === "allowed" ? "Allowed" : "Didn't allow"} ${action.title} to use it`,
        title:
          action.path === undefined ? (action.app ?? "") : nameOf(action.path),
      };
    }
    case "error": {
      return {
        context: action.where ? `Error in ${action.where}` : "Error",
        title: action.message.replace(/\.$/, ""),
      };
    }
    case "screen": {
      return { context: "", title: action.name };
    }
    case "setting": {
      return { context: `Changed to ${action.value}`, title: action.name };
    }
  }
}

/** Which of the page's filters a row shows under, past All: none for the rest. */
export type Show = "ai" | "chats" | "files" | "pages";

export const SHOWS = [
  "pages",
  "files",
  "chats",
  "ai",
] as const satisfies Show[];

/** The filter an entry shows under, besides All. */
function showOf(entry: TimelineEntry): Show | undefined {
  if (entry.kind === "turn") {
    return "ai";
  }
  switch (entry.action.kind) {
    case "page": {
      return "pages";
    }
    case "folder":
    case "file":
    case "open-with":
    case "edit":
    case "move":
    case "copy":
    case "rename":
    case "trash":
    case "new-folder":
    case "download": {
      return "files";
    }
    case "chat":
    case "permission": {
      return "chats";
    }
    default: {
      return undefined;
    }
  }
}

/** Everything a search may find a person's row by: its words, and the paths and address behind them. */
function actionHaystack(action: ShownAction, words: Words): string[] {
  const { context, title } = actionText(action, words);
  const found = [title, context];
  switch (action.kind) {
    case "move":
    case "copy": {
      found.push(action.from, action.to, ...action.names);
      break;
    }
    case "rename": {
      found.push(action.from, action.to);
      break;
    }
    case "trash": {
      found.push(...action.paths);
      break;
    }
    case "page": {
      found.push(action.url);
      break;
    }
    case "download": {
      found.push(action.path, action.url ?? "");
      break;
    }
    case "folder":
    case "file":
    case "open-with":
    case "edit":
    case "new-folder": {
      found.push(action.path);
      break;
    }
    case "permission": {
      found.push(action.path ?? "", action.title);
      break;
    }
    default: {
      break;
    }
  }
  return found;
}

/**
 * The entries a filter and a search leave: those under the filter (all of
 * them without one) whose words, paths or address have every word of the
 * search in them, case aside.
 */
export function entriesShown(
  entries: readonly TimelineEntry[],
  {
    modelName,
    q,
    show,
    words,
  }: {
    modelName: (id: null | string) => string;
    q: string;
    show: Show | undefined;
    words: Words;
  },
): TimelineEntry[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (show !== undefined && showOf(entry) !== show) {
      return false;
    }
    if (terms.length === 0) {
      return true;
    }
    const haystack = (
      entry.kind === "turn"
        ? [
            ...Object.values(turnText(entry.turn, modelName)),
            ...entry.turn.requests.flatMap((request) => [
              request.chatTitle ?? "",
              modelOf(request) ?? "",
            ]),
          ]
        : actionHaystack(entry.action, words)
    )
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * What More from searches for: a page's site, the folder a file is in, or
 * the chat a turn or a chat row was in. None for a row with no such place.
 */
export function moreFromOf(
  entry: TimelineEntry,
): undefined | { label: string; q: string } {
  if (entry.kind === "turn") {
    const title = leadOf(entry.turn)?.chatTitle;
    return title ? { label: title, q: title } : undefined;
  }
  const { action } = entry;
  switch (action.kind) {
    case "page": {
      const site = siteOf(action.url);
      return { label: site, q: site };
    }
    case "file":
    case "open-with":
    case "edit":
    case "new-folder":
    case "download": {
      const folder = folderOf(action.path);
      return { label: nameOf(folder), q: folder };
    }
    case "folder": {
      return { label: nameOf(action.path), q: action.path };
    }
    case "move":
    case "copy": {
      return { label: nameOf(action.to), q: action.to };
    }
    case "rename": {
      const folder = folderOf(action.to);
      return { label: nameOf(folder), q: folder };
    }
    case "chat":
    case "permission": {
      return { label: action.title, q: action.title };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Where opening a row of the person's own goes: the file or folder it names
 * (by its path, so a copy is the path on this computer), where files were
 * moved or copied to with the first selected, the chat (a permission's too),
 * or the page; nothing for what has no place to open.
 */
export function placeOf(action: ShownAction): OpenTarget | undefined {
  switch (action.kind) {
    case "folder":
    case "new-folder": {
      return { kind: "path", path: `${action.path.replace(/[\\/]+$/, "")}/` };
    }
    case "file":
    case "edit":
    case "open-with":
    case "download": {
      return { kind: "path", path: action.path };
    }
    case "rename": {
      return { kind: "path", path: action.to };
    }
    case "move":
    case "copy": {
      const first = action.names[0];
      return {
        href: folderHref(
          action.to,
          first === undefined ? {} : { select: nameOf(first) },
        ),
        kind: "screen",
      };
    }
    case "chat":
    case "permission": {
      const id = ChatIdSchema.safeParse(action.id);
      return id.success
        ? { href: chatHref(id.data), kind: "screen" }
        : undefined;
    }
    case "page": {
      return isWebPage(action.url)
        ? { kind: "page", url: action.url }
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

type Purpose = ActivityRequest["purpose"];

/** What a turn did, by the purpose its requests were for. */
const DID: Record<Purpose, string> = {
  "account-check": "Checked an account",
  "app-search": "Searched apps",
  chat: "Answered",
  "chat-search": "Searched your chats",
  "chat-title": "Named a chat",
  "emoji-suggestion": "Suggested an emoji",
  image: "Made an image",
  "next-message": "Suggested a reply",
  other: "Made an AI request",
  "project-backfill": "Sorted chats into projects",
  "project-suggestion": "Suggested a project",
  "settings-search": "Searched Settings",
  task: "Worked on a task",
  "title-check": "Checked a chat's name",
  "web-search": "Searched the web",
  "work-summary": "Summarized the work",
  "x-search": "Searched X",
};

/** The purposes that name a turn ahead of the rest of its requests, first first. */
const LEADING: readonly Purpose[] = [
  "chat",
  "task",
  "image",
  "web-search",
  "x-search",
  "next-message",
];

/** The request that says what a turn was: its newest of the leading purpose. */
export function leadOf(turn: Turn): ActivityRequest | undefined {
  for (const purpose of LEADING) {
    const lead = turn.requests.find((request) => request.purpose === purpose);
    if (lead) {
      return lead;
    }
  }
  return turn.requests[0];
}

/** The model a request shows: the one that answered when the response said, otherwise the one asked for. */
export function modelOf(request: ActivityRequest) {
  return request.modelServed ?? request.modelRequested;
}

/**
 * What an AI row says: the chat it was in, then what the turn did, the
 * model and how many requests it took. A turn in no chat is named by what
 * it did.
 */
export function turnText(
  turn: Turn,
  modelName: (id: null | string) => string,
): RowText {
  const lead = leadOf(turn);
  if (!lead) {
    return { context: "", title: "" };
  }
  const count = turn.requests.length;
  const requests = `${count} ${count === 1 ? "request" : "requests"}`;
  const model = modelName(modelOf(lead));
  const did = DID[lead.purpose];
  const chat =
    lead.chatId === null ? undefined : (lead.chatTitle ?? "Deleted chat");
  const facts = [chat === undefined ? undefined : did, model, requests].filter(
    (fact): fact is string => Boolean(fact),
  );
  return { context: facts.join(" · "), title: chat ?? did };
}

/** Where opening an AI row goes: the chat its requests were for, while it is there. */
export function turnPlaceOf(turn: Turn): OpenTarget | undefined {
  const lead = leadOf(turn);
  const id = ChatIdSchema.safeParse(lead?.chatId);
  return id.success && lead?.chatTitle !== null
    ? { href: chatHref(id.data), kind: "screen" }
    : undefined;
}
