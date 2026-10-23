import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { knownSignedInPeople } from "@/electron-main/lib/get-signed-in-user";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { getProblemsStore } from "@/electron-main/stores/machine/problems";
import {
  FEEDBACK_TOO_LARGE,
  type FeedbackDescription,
  type FeedbackItem,
  MAX_REPORT_BYTES,
  MAX_REPORT_DETAILS,
  MAX_REPORT_EVENTS,
  MAX_REPORT_FILES,
  type PendingProblem,
  type ReportInput,
} from "@/shared/problem-reports";
import { osConventionsFor } from "@/shared/os-conventions";
import { app } from "electron";
import {
  type ExceptionEvent,
  ExceptionEventSchema,
  formatExceptionEvent,
} from "@instrument-org/shared/exceptions";
import {
  chatDir,
  type ChatId,
  chatSessions,
  chatStartedWithApp,
  listMemories,
  memoryDir,
} from "@instrument-org/workspace/electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { createScopedLogger, getMainLogFilePath } from "./electron-logger";
import { listExceptionEvents } from "./exception-store";
import {
  createReportRedactor,
  type ReportKnownValues,
} from "./report-redaction";

const log = createScopedLogger("ProblemReports");

/** How many of the log's last lines a report carries. */
const LOG_TAIL_LINES = 30;

/** How much of the log's end is read to find those lines. */
const LOG_TAIL_BYTES = 16 * 1024;

/** The problems from earlier sessions still waiting on the person. */
export function listPendingProblems(): PendingProblem[] {
  return getProblemsStore().get("pending");
}

function writePendingProblems(problems: PendingProblem[]) {
  getProblemsStore().set("pending", problems);
}

/** Takes a problem off the list, sent or dismissed. */
export function clearPendingProblem(fingerprint: string) {
  writePendingProblems(
    listPendingProblems().filter((p) => p.fingerprint !== fingerprint),
  );
}

/**
 * Adds a problem to the list, or counts it again when one with the same
 * fingerprint is already waiting, so a crash on every launch stays one item.
 */
function addPendingProblem(problem: Omit<PendingProblem, "count" | "firstAt">) {
  const problems = listPendingProblems();
  const same = problems.find((p) => p.fingerprint === problem.fingerprint);
  writePendingProblems(
    same
      ? problems.map((p) =>
          p === same
            ? { ...problem, count: same.count + 1, firstAt: same.firstAt }
            : p,
        )
      : [...problems, { ...problem, count: 1, firstAt: problem.lastAt }],
  );
}

/**
 * How the last session ended, as the crash diagnostics found it at this
 * start: whether it never exited, the uncaught throw it wrote down, and the
 * native crash dumps written since.
 */
export type EndedSession = {
  crashRecord: ExceptionEvent | undefined;
  dumps: number;
  endedAt: number;
  previousVersion: string | undefined;
  unclean: boolean;
};

/**
 * Turns how the last session ended into a problem for the bell, or nothing.
 *
 * Only a session that never exited counts. A throw or a crash dump from a
 * session that went on to quit normally was survived, and the person saw
 * whatever came of it then, so it stays in the log alone. A session that
 * never exited with a throw or a dump on record crashed; with neither, it
 * most likely stopped responding and was force-quit, which is a hang. In
 * development, stopping the dev server or reloading main ends every session
 * that way, so a hang is only recorded for a packaged build.
 */
export function recordEndedSession(session: EndedSession) {
  if (!session.unclean) {
    return;
  }
  const crashed = session.crashRecord !== undefined || session.dumps > 0;
  if (!crashed && !app.isPackaged) {
    return;
  }
  const thrown = session.crashRecord?.exceptions.at(-1);
  const problem = crashed
    ? {
        fingerprint: session.crashRecord
          ? `crash:${session.crashRecord.fingerprint}`
          : fingerprintOf("native", "crash"),
        kind: "crash" as const,
        title: thrown
          ? `${thrown.type}: ${thrown.value}`.slice(0, 300)
          : "Instrument quit unexpectedly",
      }
    : {
        fingerprint: fingerprintOf("unclean-exit", "hang"),
        kind: "hang" as const,
        title: "Instrument didn't close properly",
      };
  const { details, events } = describeProblem({
    ended: crashed
      ? session.crashRecord
        ? "crashed after an uncaught error"
        : `crashed (${session.dumps} crash dump${session.dumps === 1 ? "" : "s"} kept on ${osConventionsFor(process.platform).thisComputer})`
      : "ended without closing, with no crash on record",
    lead: session.crashRecord,
    surface: problem.kind,
    version: session.previousVersion,
  });
  addPendingProblem({ ...problem, details, events, lastAt: session.endedAt });
}

/**
 * Sends what is waiting when the person chose to have error reports sent
 * automatically. Called once the app is ready, since sending needs the
 * network and the account.
 */
export async function sendPendingAutomatically() {
  if (!getMachinePreferences().get("sendErrorReportsAutomatically")) {
    return;
  }
  for (const problem of listPendingProblems()) {
    try {
      await sendReport({
        automatic: true,
        details: problem.details,
        events: problem.events,
        fingerprint: problem.fingerprint,
        kind: problem.kind,
        surface: problem.kind,
        title: problem.title,
      });
      clearPendingProblem(problem.fingerprint);
    } catch (error) {
      log.warn(
        new Error("Could not send a report automatically", { cause: error }),
      );
    }
  }
}

/**
 * What a report carries, which is also exactly what Show details shows: the
 * details text (versions, where it came from, the recent exceptions in
 * readable form, and the last lines of the log) and those exceptions' events
 * whole. `lead` is the exception the report is about, first; the others are
 * the recorded problems seen most recently. The oldest are left out until
 * the details fit their cap and the whole report fits the service's. The
 * home folder reads `~`, and the person's name, email and login and any
 * secret are taken out of the details and the events. Which account sent it is the reports service's to
 * know, from the token the request carries.
 */
export function describeProblem({
  ended,
  found = [],
  lead,
  surface,
  version = app.getVersion(),
}: {
  ended?: string;
  /** What the app found about the condition a report is about. */
  found?: string[];
  lead?: ExceptionEvent;
  surface: string;
  version?: string;
}): { details: string; events: ExceptionEvent[] } {
  const others = listExceptionEvents()
    .filter((event) => event.fingerprint !== lead?.fingerprint)
    .toSorted((a, b) => b.lastAt - a.lastAt);
  const head = [
    `appVersion: ${version}`,
    `platform: ${process.platform} ${process.getSystemVersion()} ${process.arch}`,
    `surface: ${surface}`,
    ...(ended ? [`ended: ${ended}`] : []),
    ...found,
  ].join("\n");
  const tail = readLogLines(LOG_TAIL_BYTES).slice(-LOG_TAIL_LINES);
  const logLines =
    tail.length > 0 ? ["Last log lines:", ...tail].join("\n") : undefined;
  const redactor = reportRedactor();
  const compose = (events: readonly ExceptionEvent[]) =>
    redactor.text(
      [
        head,
        ...events.map((event, index) =>
          [
            index === 0 && lead ? "The error:" : "Another recent error:",
            formatExceptionEvent(event, {
              breadcrumbs: index === 0 ? undefined : 0,
            }),
          ].join("\n"),
        ),
        ...(logLines ? [logLines] : []),
      ].join("\n\n"),
    );

  const events = [...(lead ? [lead] : []), ...others].slice(
    0,
    MAX_REPORT_EVENTS,
  );
  let details = compose(events);
  while (
    events.length > 0 &&
    (details.length > MAX_REPORT_DETAILS ||
      reportBytes(details, events) > REPORT_BUDGET_BYTES)
  ) {
    events.pop();
    details = compose(events);
  }
  return {
    details: details.slice(0, MAX_REPORT_DETAILS),
    events: events.map((event) => redactEvent(redactor, event)),
  };
}

type ReportRedactor = ReturnType<typeof createReportRedactor>;

/**
 * What a report takes out, from what this computer knows without waiting:
 * the accounts signed in, the home folder and the login, and whatever the
 * caller adds.
 */
function reportRedactor(
  extra: Pick<ReportKnownValues, "chatId" | "memories"> = {},
): ReportRedactor {
  let login: string | undefined;
  try {
    login = os.userInfo().username;
  } catch {
    // No user record for this process's uid, as in some containers.
  }
  return createReportRedactor({
    ...extra,
    home: os.homedir(),
    login,
    people: knownSignedInPeople(),
  });
}

function redactEvent(
  redactor: ReportRedactor,
  event: ExceptionEvent,
): ExceptionEvent {
  return ExceptionEventSchema.parse(redactor.deep(event));
}

// Room left in the service's cap for the note, the title, and the rest.
const REPORT_BUDGET_BYTES = MAX_REPORT_BYTES - 64 * 1024;

function reportBytes(details: string, events: readonly ExceptionEvent[]) {
  return Buffer.byteLength(JSON.stringify({ details, events }));
}

/** The log's last `bytes`, as the whole lines in them. */
function readLogLines(bytes: number): string[] {
  try {
    const file = getMainLogFilePath();
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      const lines = buffer.toString("utf8").split("\n").filter(Boolean);
      // The first line read may start mid-line, unless the read began at the top.
      return start > 0 ? lines.slice(1) : lines;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    // No log in development, or none written yet.
    return [];
  }
}

export function fingerprintOf(signature: string, kind: string) {
  return `${kind}:${createHash("sha256").update(signature).digest("hex").slice(0, 16)}`;
}

/**
 * A report as JSON, its oldest events left out while it is over the
 * service's cap. A report described here already fits; this is for one
 * waiting since an earlier build, or a note that tipped it over.
 */
function reportBody(input: ReportInput): string {
  const events = [...(input.events ?? [])];
  let body = JSON.stringify({ ...input, events });
  while (events.length > 0 && Buffer.byteLength(body) > MAX_REPORT_BYTES) {
    events.pop();
    body = JSON.stringify({ ...input, events });
  }
  return body;
}

/**
 * Sends one report to the API, which hands it to the reports service, and
 * answers its id. A signed-in report carries the account's token, the way every request to us does, so
 * it can be answered; one from someone not signed in goes without.
 */
export async function sendReport(input: ReportInput): Promise<{ id: string }> {
  const response = await fetch(new URL("/reports", platformApiBaseUrl()), {
    body: reportBody(input),
    headers: {
      ...getPlatformApiHeaders(),
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Too many reports were sent just now. Try again in a minute."
        : `The report wasn't accepted (${response.status}).`,
    );
  }
  const { id } = z.object({ id: z.string() }).parse(await response.json());
  log.info(`Sent ${input.kind} report ${id} from ${input.surface}`);
  return { id };
}

/** How much of the log's end feedback carries, in whole lines. */
const FEEDBACK_LOG_BYTES = 512 * 1024;

/** Where the app's log goes in a feedback report. */
export const FEEDBACK_LOG_PATH = "diagnostics/app.log";

/** A session's log, `<session>.<device>.jsonl` and its later generations. */
const SESSION_LOG = /^(ses_[0-9A-Za-z]+)\..+\.jsonl$/;

/** The chat's own files beside its logs: each device's settings and state, and the notes a handoff leaves. */
const CHAT_SETTINGS =
  /^(?:(?:settings|marks)\..+\.jsonl|state\..+\.json|handoff-notes\.md)$/;

/** A name that can stand in a report's path, which a sync engine's copy (`… 2.jsonl`) cannot. */
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;

type ChatFile = { content: string; name: string };

/**
 * A chat's record files as feedback offers them: one item per session, the
 * chat's own first and then its tasks, each with every log its devices
 * wrote, and one for the chat's settings. Each file goes as
 * `chat/<name on disk>`, so the folder can be laid out again from the
 * report. Blobs and attachments are never among them, nor the work folder.
 */
export function chatFeedbackItems({
  files,
  sessions,
}: {
  files: readonly ChatFile[];
  sessions: readonly { id: string; parentId?: string; title: string }[];
}): FeedbackItem[] {
  const plain = files.filter((file) => PLAIN_NAME.test(file.name));
  const toReport = (list: readonly ChatFile[]) =>
    list.map((file) => ({ content: file.content, path: `chat/${file.name}` }));
  const logs = new Map<string, ChatFile[]>();
  for (const file of plain) {
    const session = SESSION_LOG.exec(file.name)?.[1];
    if (session) {
      logs.set(session, [...(logs.get(session) ?? []), file]);
    }
  }
  const known = new Set(sessions.map((session) => session.id));
  const ordered = [
    ...sessions,
    // A log whose session the records could not name still goes.
    ...[...logs.keys()]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, parentId: id, title: id })),
  ];
  const items = ordered.flatMap((session): FeedbackItem[] => {
    const own = logs.get(session.id);
    if (!own) {
      return [];
    }
    return [
      feedbackItem({
        files: toReport(own),
        id: `session:${session.id}`,
        kind: session.parentId ? "task" : "chat",
        label: session.parentId ? `Task: ${session.title}` : session.title,
      }),
    ];
  });
  const settings = plain.filter((file) => CHAT_SETTINGS.test(file.name));
  return settings.length > 0
    ? [
        ...items,
        feedbackItem({
          files: toReport(settings),
          id: "chat-settings",
          kind: "settings",
          label: "Chat settings",
        }),
      ]
    : items;
}

function feedbackItem(item: Omit<FeedbackItem, "bytes">): FeedbackItem {
  return { ...item, bytes: itemBytes(item) };
}

/** What an item adds to a report's body: its files and events as JSON. */
function itemBytes({
  events = [],
  files,
}: Pick<FeedbackItem, "events" | "files">) {
  return (
    files.reduce((sum, file) => sum + jsonBytes(file) + 1, 0) +
    events.reduce((sum, event) => sum + jsonBytes(event) + 1, 0)
  );
}

function jsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * What feedback can carry, for the dialog to offer: the chat it is about,
 * when there is one, read from its record folder, and the diagnostics. Each
 * is redacted here, before the dialog sees it, so what Show details shows is
 * what is sent.
 */
export async function describeFeedback(
  chatId: ChatId | undefined,
): Promise<FeedbackDescription> {
  const redactor = reportRedactor({
    chatId,
    memories: await listMemories(memoryDir()),
  });
  const chat = chatId
    ? await describeChatFeedback(chatId, redactor)
    : undefined;
  return {
    chat: chat && {
      items: chat.items,
      taskCount: chat.items.filter((item) => item.kind === "task").length,
    },
    diagnostics: {
      items: diagnosticsItems(
        chatId && { id: chatId, startedWith: chat?.startedWith },
        redactor,
      ),
    },
  };
}

async function describeChatFeedback(chatId: ChatId, redactor: ReportRedactor) {
  const dir = chatDir(chatId);
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        content: await fs.promises.readFile(path.join(dir, entry.name), "utf8"),
        name: entry.name,
      })),
  );
  return {
    items: chatFeedbackItems({
      files: redactor.chatFiles(files),
      sessions: await chatSessions(chatId),
    }),
    startedWith: await chatStartedWithApp(chatId),
  };
}

/**
 * The diagnostics feedback offers: what app and computer it came from, the
 * errors recorded lately, and the end of the app's log, redacted as the chat
 * is. An item with nothing in it is left out.
 */
function diagnosticsItems(
  chat: undefined | { id: ChatId; startedWith: string | undefined },
  redactor: ReportRedactor,
): FeedbackItem[] {
  const about = {
    app: { packaged: app.isPackaged, version: app.getVersion() },
    ...(chat && {
      chat: { id: chat.id, startedWith: chat.startedWith ?? null },
    }),
    locale: app.getLocale(),
    os: {
      arch: process.arch,
      platform: process.platform,
      release: os.release(),
      version: process.getSystemVersion(),
    },
    versions: {
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
    },
  };
  const events = listExceptionEvents()
    .toSorted((a, b) => b.lastAt - a.lastAt)
    .slice(0, MAX_REPORT_EVENTS)
    .map((event) => redactEvent(redactor, withProblemBreadcrumbs(event)));
  const logLines = readLogLines(FEEDBACK_LOG_BYTES);
  return [
    feedbackItem({
      files: [
        {
          content: JSON.stringify(about, null, 2),
          path: "diagnostics/about.json",
        },
      ],
      id: "about",
      kind: "about",
      label: `About ${osConventionsFor(process.platform).thisComputer} and app`,
    }),
    ...(events.length > 0
      ? [
          feedbackItem({
            events,
            files: [],
            id: "errors",
            kind: "errors",
            label: "Recent errors",
          }),
        ]
      : []),
    ...(logLines.length > 0
      ? [
          feedbackItem({
            files: [
              {
                content: redactor.text(`${logLines.join("\n")}\n`),
                path: FEEDBACK_LOG_PATH,
              },
            ],
            id: "log",
            kind: "log",
            label: "App log",
          }),
        ]
      : []),
  ];
}

/** The breadcrumb levels feedback's recent errors keep. */
const PROBLEM_LEVELS = new Set(["error", "fatal", "warn", "warning"]);

/**
 * An error as feedback's "Recent errors" carries it: the trail of every log
 * line and call before it cut to the warnings and failures, since the app
 * log beside it already has the rest.
 */
export function withProblemBreadcrumbs(event: ExceptionEvent): ExceptionEvent {
  return {
    ...event,
    breadcrumbs: event.breadcrumbs.filter((crumb) =>
      PROBLEM_LEVELS.has(crumb.level),
    ),
  };
}

/** Feedback whose chat alone is more than one report may carry. */
export class FeedbackTooLargeError extends Error {
  constructor() {
    super(FEEDBACK_TOO_LARGE);
  }
}

/**
 * The report feedback sends: the person's note and the items they kept
 * checked, their files in `files` and the recent errors in `events`. Over
 * the service's cap, the log loses lines from its top first, then the
 * oldest errors go; a chat still over it is refused whole rather than sent
 * cut short.
 */
export function feedbackReportInput({
  items,
  note,
  surface,
  title,
}: {
  items: readonly FeedbackItem[];
  note?: string;
  surface: string;
  title: string;
}): ReportInput {
  const files = items.flatMap((item) => item.files);
  const events = items
    .flatMap((item) => item.events ?? [])
    .toSorted((a, b) => b.lastAt - a.lastAt)
    .slice(0, MAX_REPORT_EVENTS);
  const compose = (): ReportInput => ({
    automatic: false,
    ...(events.length > 0 && { events }),
    ...(files.length > 0 && { files }),
    kind: "feedback",
    ...(note && { note }),
    surface,
    title,
  });

  let over = jsonBytes(compose()) - MAX_REPORT_BYTES;
  const logIndex = files.findIndex((file) => file.path === FEEDBACK_LOG_PATH);
  const logFile = files[logIndex];
  if (over > 0 && logFile) {
    // A line's share of the body is its own JSON escaping, so lines come off
    // the top until the body fits or the log is gone.
    const lines = logFile.content.split(/(?<=\n)/);
    let drop = 0;
    while (drop < lines.length && over > 0) {
      over -= jsonBytes(lines[drop]) - 2;
      drop += 1;
    }
    if (drop < lines.length) {
      files[logIndex] = { ...logFile, content: lines.slice(drop).join("") };
    } else {
      files.splice(logIndex, 1);
    }
    over = jsonBytes(compose()) - MAX_REPORT_BYTES;
  }
  while (over > 0 && events.length > 0) {
    events.pop();
    over = jsonBytes(compose()) - MAX_REPORT_BYTES;
  }
  if (over > 0 || files.length > MAX_REPORT_FILES) {
    throw new FeedbackTooLargeError();
  }
  return compose();
}
