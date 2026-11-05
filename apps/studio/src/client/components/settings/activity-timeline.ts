import { folderOf, nameOf } from "@/client/components/window/host-path";
import { chatHref } from "@/client/components/window/window-href";
import { isWebPage, type OpenTarget } from "@/client/lib/open-target";
// Types alone: the client opens its channel to the main process on import.
import type { RPCInput, RPCOutput } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
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

export const ACTIVITY_VIEWS = [
  "all",
  "yours",
  "ai",
] as const satisfies readonly ActivityView[];

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
 * A day's head as the list writes it: Today, Yesterday, then the weekday and
 * date, with the year only when it is not this one.
 */
export function dayLabel(at: number, now: Date, locale: string): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (at >= today.getTime()) {
    return "Today";
  }
  if (at >= yesterday.getTime()) {
    return "Yesterday";
  }
  const day = new Date(at);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(day);
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

/** A row's two lines. */
export type RowText = { primary: string; secondary: string };

/** The words of the system the rows are read on: where a deleted file waits. */
export type Words = { trash: string };

const quoted = (name: string) => `“${name}”`;

/** The name of the folder a path is in. */
const parentName = (path: string) => nameOf(folderOf(path));

/** One name in quotes, or how many files there are. */
const filesNamed = (paths: readonly string[]) =>
  paths.length === 1 && paths[0] !== undefined
    ? quoted(nameOf(paths[0]))
    : `${paths.length} files`;

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

/** What a row of the person's own says they did, and where. */
export function actionText(action: ShownAction, words: Words): RowText {
  switch (action.kind) {
    case "folder": {
      return {
        primary: `Opened ${quoted(nameOf(action.path))}`,
        secondary: `Folder in ${parentName(action.path)}`,
      };
    }
    case "file": {
      return {
        primary: `Opened ${quoted(nameOf(action.path))}`,
        secondary: `In ${parentName(action.path)}`,
      };
    }
    case "open-with": {
      return {
        primary: `Opened ${quoted(nameOf(action.path))} in ${action.app ?? "another app"}`,
        secondary: `In ${parentName(action.path)}`,
      };
    }
    case "edit": {
      return {
        primary: `Edited ${quoted(nameOf(action.path))}`,
        secondary: `In ${parentName(action.path)}`,
      };
    }
    case "move":
    case "copy": {
      return {
        primary: `${action.kind === "move" ? "Moved" : "Copied"} ${filesNamed(action.names)} to ${quoted(nameOf(action.to))}`,
        secondary: `From ${nameOf(action.from)}`,
      };
    }
    case "rename": {
      return {
        primary: `Renamed ${quoted(nameOf(action.from))} to ${quoted(nameOf(action.to))}`,
        secondary: `In ${parentName(action.to)}`,
      };
    }
    case "trash": {
      return {
        primary: `Moved ${filesNamed(action.paths)} to the ${words.trash}`,
        secondary: `In ${parentName(action.paths[0] ?? "")}`,
      };
    }
    case "new-folder": {
      return {
        primary: `Made the folder ${quoted(nameOf(action.path))}`,
        secondary: `In ${parentName(action.path)}`,
      };
    }
    case "chat": {
      return { primary: `Opened ${quoted(action.title)}`, secondary: "Chat" };
    }
    case "page": {
      return {
        primary: `Visited ${action.title ? quoted(action.title) : shortAddress(action.url)}`,
        secondary: siteOf(action.url),
      };
    }
    case "download": {
      return {
        primary: `Downloaded ${quoted(nameOf(action.path))}`,
        secondary: `To ${parentName(action.path)}`,
      };
    }
    case "app": {
      return {
        primary:
          action.did === "signed in"
            ? `Signed in to ${action.name}`
            : action.did === "disconnected"
              ? `Disconnected ${action.name}`
              : `Couldn't sign in to ${action.name}`,
        secondary: "App",
      };
    }
    case "update": {
      return {
        primary: `Updated ${APP_NAME} to ${action.to}`,
        secondary: `From ${action.from}`,
      };
    }
    case "permission": {
      const what =
        action.path === undefined ? (action.app ?? "") : nameOf(action.path);
      return {
        primary: `${action.did === "allowed" ? "Allowed" : "Didn't allow"} ${quoted(action.title)} to use ${what}`,
        secondary: "Permission",
      };
    }
    case "error": {
      return {
        primary: action.message.replace(/\.$/, ""),
        secondary: action.where ? `Error in ${action.where}` : "Error",
      };
    }
    case "screen": {
      return { primary: `Opened ${action.name}`, secondary: "Screen" };
    }
    case "setting": {
      return {
        primary: `Changed ${action.name} to ${action.value}`,
        secondary: "Setting",
      };
    }
  }
}

/**
 * Where clicking a row of the person's own goes: the folder, file, chat or
 * page it names (the chat a permission was for), or nowhere for what has no
 * place to open.
 */
export function placeOf(action: ShownAction): OpenTarget | undefined {
  switch (action.kind) {
    case "folder":
    case "new-folder": {
      return { href: folderHref(action.path), kind: "screen" };
    }
    case "file":
    case "edit":
    case "open-with":
    case "download": {
      return { href: fileHref(action.path), kind: "screen" };
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
    case "rename": {
      return {
        href: folderHref(folderOf(action.to), { select: nameOf(action.to) }),
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
 * What an AI row says: what the turn did, in which chat, and the model with
 * how many requests it took.
 */
export function turnText(
  turn: Turn,
  modelName: (id: null | string) => string,
): RowText {
  const lead = leadOf(turn);
  if (!lead) {
    return { primary: "", secondary: "" };
  }
  const chat =
    lead.purpose === "chat-title" || lead.chatId === null
      ? ""
      : lead.chatTitle === null
        ? " in a deleted chat"
        : ` in ${quoted(lead.chatTitle)}`;
  const count = turn.requests.length;
  const requests = `${count} ${count === 1 ? "request" : "requests"}`;
  const model = modelName(modelOf(lead));
  return {
    primary: `${DID[lead.purpose]}${chat}`,
    secondary: model ? `${model} · ${requests}` : requests,
  };
}
