import { APP_NAME } from "@instrument-org/shared";
import { unique } from "radashi";
import { z } from "zod";

import { FOLDER_VARIABLES } from "../../constants";
import { ChatIdSchema } from "../../schemas/chat-id";
import { readActions } from "../actions/read";
import { ActionSchema } from "../actions/schema";
import { actionSentence } from "../actions/sentence";
import { ACTIONS_NOT_SHARED, mayShareActions } from "../actions/sharing";
import { type ActivityRow } from "../activity/schema";
import { listActivity } from "../activity/store";
import { gatherTurns } from "../activity/turns";
import { chatTitle } from "../chat-info";
import { ACTIVITY_COMMAND } from "../../model-text/commands/activity-command";
import { defineCapability } from "./define";

/** How far back a listing reaches: whole minutes, hours or days. */
const SINCE = /^(\d+)(m|h|d)$/;

const UNIT_MS = { d: 86_400_000, h: 3_600_000, m: 60_000 } as const;

const DAY_MS = UNIT_MS.d;

function sinceMs(since: string): number {
  const match = SINCE.exec(since);
  const unit = match?.[2];
  return unit === "m" || unit === "h" || unit === "d"
    ? Number(match?.[1]) * UNIT_MS[unit]
    : 0;
}

/** The AI requests one chat turn made, as a row of the listing. */
const RequestTurnSchema = z.object({
  /** When its first request started. */
  at: z.iso.datetime(),
  /** The chat it was in, by its id and its title while it has one; none for requests no chat made. */
  chat: z.object({ id: z.string(), title: z.string().optional() }).optional(),
  count: z.number(),
  /** Each error a request failed with, and how many failed with it. */
  failed: z.array(z.object({ count: z.number(), error: z.string() })),
  /** The models that answered, or were asked when the answer did not say. */
  models: z.array(z.string()),
  /** From the first request's start to the end of the last. */
  ms: z.number(),
  purpose: z.string(),
  /** Where requests no chat made came from. */
  surface: z.string().optional(),
});

type RequestTurn = z.output<typeof RequestTurnSchema>;

const ActivityOutput = z.object({
  /** Rows that matched but were older than the newest `limit`. */
  earlier: z.number(),
  grep: z.string().optional(),
  /**
   * Oldest first, each the action as logged or the AI requests of a chat
   * turn, with its sentence.
   */
  rows: z.array(
    z.union([
      z.object({ action: ActionSchema, text: z.string() }),
      z.object({ requests: RequestTurnSchema, text: z.string() }),
    ]),
  ),
  /** How far back the listing reached, as it was asked: `2h`. */
  since: z.string(),
});

type Row = z.output<typeof ActivityOutput>["rows"][number];

/** A span as a person says it: `42s`, `1m 10s`, `1h 5m`. */
function lasting(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A chat turn's requests as a sentence: how many, where, which model, how long, and what failed. */
function turnSentence(turn: RequestTurn): string {
  const where = turn.chat
    ? `in the chat ${turn.chat.title === undefined ? "" : `"${turn.chat.title}", `}its records in $${FOLDER_VARIABLES.chats}/${turn.chat.id}`
    : `from ${turn.surface ?? "the app"}`;
  const failed = turn.failed
    .map(({ count, error }) => `"${error}"${count > 1 ? ` ×${count}` : ""}`)
    .join(", ");
  return [
    `AI: ${turn.count} ${turn.count === 1 ? "request" : "requests"} (${turn.purpose}) ${where}`,
    `model ${turn.models.join(", ") || "unknown"}`,
    `${lasting(turn.ms)} from first to last`,
    ...(failed
      ? [
          `${turn.failed.reduce((sum, each) => sum + each.count, 0)} failed: ${failed}`,
        ]
      : []),
  ].join(", ");
}

/** One turn's requests, newest first, as its row says them. */
async function requestTurn(
  requests: readonly ActivityRow[],
  titleOf: (chat: string) => Promise<string | undefined>,
): Promise<RequestTurn> {
  const oldest = requests.at(-1) ?? requests[0];
  const start = Math.min(...requests.map((each) => each.startedAt));
  const end = Math.max(
    ...requests.map((each) => each.startedAt + (each.durationMs ?? 0)),
  );
  const failures = new Map<string, number>();
  for (const each of requests) {
    if (each.status === "failed" || each.status === "limited") {
      const error = each.error ?? each.status;
      failures.set(error, (failures.get(error) ?? 0) + 1);
    }
  }
  const chatId = oldest?.chatId ?? null;
  const title = chatId === null ? undefined : await titleOf(chatId);
  return {
    at: new Date(start).toISOString(),
    ...(chatId === null
      ? {}
      : { chat: { id: chatId, ...(title === undefined ? {} : { title }) } }),
    count: requests.length,
    failed: [...failures].map(([error, count]) => ({ count, error })),
    models: unique(
      requests.flatMap((each) => each.modelServed ?? each.modelRequested ?? []),
    ),
    ms: end - start,
    purpose: oldest?.purpose ?? "other",
    ...(oldest?.surface ? { surface: oldest.surface } : {}),
  };
}

/** The most requests a listing reads. */
const REQUESTS_MAX = 5000;

/**
 * What the person did from `since` to `until`, with the AI requests made
 * among it gathered into turns, oldest first, each with its sentence.
 * Reading the chat that asks is coming back to it, which says nothing the
 * chat does not already know.
 */
async function rowsOf({
  chatId,
  since,
  until,
}: {
  chatId: string;
  since: number;
  until: number;
}): Promise<Row[]> {
  const actions = (await readActions({ since, until })).filter(
    (action) => !(action.kind === "chat" && action.id === chatId),
  );
  const requests = await listActivity({
    filter: { since, until },
    limit: REQUESTS_MAX,
    offset: 0,
    sort: { column: "startedAt", direction: "desc" },
  });
  const titles = new Map<string, Promise<string | undefined>>();
  const titleOf = (chat: string) => {
    const known = titles.get(chat);
    if (known) {
      return known;
    }
    const id = ChatIdSchema.safeParse(chat);
    const title = id.success ? chatTitle(id.data) : Promise.resolve(undefined);
    titles.set(chat, title);
    return title;
  };
  const gathered = gatherTurns(
    [
      ...actions.map((action) => ({ action, at: Date.parse(action.at) })),
      ...requests.map((request) => ({ at: request.startedAt, request })),
    ].toSorted((a, b) => b.at - a.at),
  );
  const rows: Row[] = [];
  for (const entry of gathered.toReversed()) {
    if (entry.kind === "action") {
      rows.push({ action: entry.action, text: actionSentence(entry.action) });
    } else {
      const turn = await requestTurn(entry.requests, titleOf);
      rows.push({ requests: turn, text: turnSentence(turn) });
    }
  }
  return rows;
}

/** A time of day on this computer's clock: `2:14 PM`. */
function clock(at: Date): string {
  const hours = at.getHours();
  return `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function dayOf(at: Date): string {
  return at.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

/** The rows under a head for each day, each at its local time. */
function listed(rows: readonly Row[]): string[] {
  const lines: string[] = [];
  let day = "";
  for (const row of rows) {
    const at = new Date("action" in row ? row.action.at : row.requests.at);
    if (dayOf(at) !== day) {
      day = dayOf(at);
      lines.push(day);
    }
    lines.push(`  ${clock(at)}  ${row.text}`);
  }
  return lines;
}

export const activityList = defineCapability({
  gate: () =>
    Promise.resolve(
      mayShareActions()
        ? { kind: "allowed" }
        : { kind: "refused", message: ACTIONS_NOT_SHARED },
    ),
  input: z.object({
    since: z
      .string()
      .regex(SINCE, {
        error: "--since takes minutes, hours or days: 30m, 2h or 1d.",
      })
      .default("2h")
      .describe("How far back: 30m, 2h or 1d. 2h when left out."),
    grep: z
      .string()
      .optional()
      .describe("Only the rows with this text in them, in any case."),
    limit: z
      .number()
      .int()
      .min(1)
      .default(60)
      .describe("The newest this many rows. 60 when left out."),
  }),
  name: "activity.list",
  output: ActivityOutput,
  async run({ grep, limit, since }, ctx) {
    const until = Date.now();
    const needle = grep?.toLowerCase();
    const rows = (
      await rowsOf({ chatId: ctx.chatId, since: until - sinceMs(since), until })
    ).filter(
      ({ text }) => needle === undefined || text.toLowerCase().includes(needle),
    );
    const shown = rows.slice(-limit);
    return {
      earlier: rows.length - shown.length,
      ...(grep === undefined ? {} : { grep }),
      rows: shown,
      since,
    };
  },
  summary: ACTIVITY_COMMAND.summary,
  surfaces: {
    cli: {
      help: `Oldest first, at the user's local time: folders and files they opened, files
they edited, moved, renamed or trashed, chats they read, pages they visited
in their own tabs, downloads, apps they signed in to or disconnected, folders
and apps they allowed or refused a chat, updates, and errors the app showed
them, with the AI requests its chats made, a chat turn to a row. The word list
is optional: \`${ACTIVITY_COMMAND.name} --since 1d\` runs it.`,
      words: ["activity", "list"],
    },
  },
  text: ({ earlier, grep, rows, since }) => {
    const span = `in the last ${since}`;
    if (rows.length === 0) {
      const further =
        sinceMs(since) < DAY_MS
          ? ` \`${ACTIVITY_COMMAND.name} --since 1d\` looks further back.`
          : sinceMs(since) < 30 * DAY_MS
            ? ` \`${ACTIVITY_COMMAND.name} --since 30d\` looks further back.`
            : "";
      return grep === undefined
        ? `Nothing the user did in ${APP_NAME} on this computer ${span} was logged.${further}`
        : `Nothing the user did in ${APP_NAME} on this computer ${span} mentions "${grep}".${further}`;
    }
    return [
      `What the user did in ${APP_NAME} on this computer ${span}, with the AI requests its chats made, a chat turn to an AI row${grep === undefined ? "" : `, where it mentions "${grep}"`}, oldest first, at their local time. Only what happened in ${APP_NAME} is here: a file they downloaded or saved in another app is not.`,
      ...(earlier > 0
        ? [`(${earlier} earlier not shown; --limit raises it)`]
        : []),
      ...listed(rows),
    ].join("\n");
  },
});
