import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { getProblemsStore } from "@/electron-main/stores/machine/problems";
import {
  MAX_REPORT_BYTES,
  MAX_REPORT_DETAILS,
  MAX_REPORT_EVENTS,
  type PendingProblem,
  type ReportInput,
} from "@/shared/problem-reports";
import { osConventionsFor } from "@/shared/os-conventions";
import { app } from "electron";
import {
  type ExceptionEvent,
  formatExceptionEvent,
} from "@instrument-org/shared/exceptions";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { z } from "zod";

import { createScopedLogger, getMainLogFilePath } from "./electron-logger";
import { listExceptionEvents } from "./exception-store";

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
 * home folder reads `~`. Which account sent it is the reports service's to
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
  const tail = readLogTail();
  const logLines =
    tail.length > 0 ? ["Last log lines:", ...tail].join("\n") : undefined;
  const compose = (events: readonly ExceptionEvent[]) =>
    scrubHome(
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
  return { details: details.slice(0, MAX_REPORT_DETAILS), events };
}

// Room left in the service's cap for the note, the title, and the rest.
const REPORT_BUDGET_BYTES = MAX_REPORT_BYTES - 64 * 1024;

function reportBytes(details: string, events: readonly ExceptionEvent[]) {
  return Buffer.byteLength(JSON.stringify({ details, events }));
}

function readLogTail(): string[] {
  try {
    const file = getMainLogFilePath();
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      const lines = buffer.toString("utf8").split("\n").filter(Boolean);
      // The first line read may start mid-line, unless the read began at the top.
      return (start > 0 ? lines.slice(1) : lines).slice(-LOG_TAIL_LINES);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    // No log in development, or none written yet.
    return [];
  }
}

function scrubHome(text: string) {
  const home = os.homedir();
  return home ? text.split(home).join("~") : text;
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
  const response = await fetch(
    new URL("/reports", import.meta.env.MAIN_VITE_APP_API_BASE_URL),
    {
      body: reportBody(input),
      headers: {
        ...getPlatformApiHeaders(),
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
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
