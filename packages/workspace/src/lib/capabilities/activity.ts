import { APP_NAME } from "@instrument-org/shared";
import { z } from "zod";

import { actionLog, KEEP_DAYS } from "../actions/log";
import { ActionSchema } from "../actions/schema";
import { actionSentence } from "../actions/sentence";
import { ACTIONS_NOT_SHARED, mayShareActions } from "../actions/sharing";
import { ACTIVITY_COMMAND } from "../shell-commands/activity-command";
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

const ActivityOutput = z.object({
  /** Rows that matched but were older than the newest `limit`. */
  earlier: z.number(),
  grep: z.string().optional(),
  /** Oldest first, each the action as logged and its sentence. */
  rows: z.array(z.object({ action: ActionSchema, text: z.string() })),
  /** How far back the listing reached, as it was asked: `2h`. */
  since: z.string(),
});

type Row = z.output<typeof ActivityOutput>["rows"][number];

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
  for (const { action, text } of rows) {
    const at = new Date(action.at);
    if (dayOf(at) !== day) {
      day = dayOf(at);
      lines.push(day);
    }
    lines.push(`  ${clock(at)}  ${text}`);
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
      await actionLog().read({ since: until - sinceMs(since), until })
    )
      // Reading this chat is coming back to it, which says nothing the chat
      // does not already know.
      .filter((action) => !(action.kind === "chat" && action.id === ctx.chatId))
      .map((action) => ({ action, text: actionSentence(action) }))
      .filter(
        ({ text }) =>
          needle === undefined || text.toLowerCase().includes(needle),
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
they edited, moved, renamed or trashed, chats they read, pages they visited in
their own tabs, downloads, and errors the app showed them. The word list is
optional: \`${ACTIVITY_COMMAND.name} --since 1d\` runs it.`,
      words: ["activity", "list"],
    },
  },
  text: ({ earlier, grep, rows, since }) => {
    const span = `in the last ${since}`;
    if (rows.length === 0) {
      const further =
        sinceMs(since) < DAY_MS
          ? `\`${ACTIVITY_COMMAND.name} --since 1d\` looks further back.`
          : `The log keeps ${KEEP_DAYS} days.`;
      return grep === undefined
        ? `Nothing the user did in ${APP_NAME} on this computer ${span} was logged. ${further}`
        : `Nothing the user did in ${APP_NAME} on this computer ${span} mentions "${grep}". ${further}`;
    }
    return [
      `What the user did in ${APP_NAME} on this computer ${span}${grep === undefined ? "" : `, where it mentions "${grep}"`}, oldest first, at their local time:`,
      ...(earlier > 0
        ? [`(${earlier} earlier not shown; --limit raises it)`]
        : []),
      ...listed(rows),
    ].join("\n");
  },
});
