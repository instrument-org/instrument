import { getPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { getProblemsStore } from "@/electron-main/stores/machine/problems";
import {
  type PendingProblem,
  type ReportInput,
} from "@/shared/problem-reports";
import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { z } from "zod";

import { createScopedLogger, getMainLogFilePath } from "./electron-logger";

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
  crashRecord: string | undefined;
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
  const firstLine = session.crashRecord
    ?.split("\n")[0]
    ?.replace(/^\S+ (uncaughtException|unhandledRejection): /, "")
    .trim();
  const problem = crashed
    ? {
        fingerprint: fingerprintOf(
          session.crashRecord ? stackSignature(session.crashRecord) : "native",
          "crash",
        ),
        kind: "crash" as const,
        title: firstLine || "Instrument quit unexpectedly",
      }
    : {
        fingerprint: fingerprintOf("unclean-exit", "hang"),
        kind: "hang" as const,
        title: "Instrument didn't close properly",
      };
  const details = describeProblem({
    ended: crashed
      ? session.crashRecord
        ? "crashed after an uncaught error"
        : `crashed (${session.dumps} crash dump${session.dumps === 1 ? "" : "s"} kept on this Mac)`
      : "ended without closing, with no crash on record",
    error: session.crashRecord,
    surface: problem.kind,
    version: session.previousVersion,
  });
  addPendingProblem({ ...problem, details, lastAt: session.endedAt });
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
 * The text a report carries, which is also exactly what Show details shows:
 * versions, where it came from, the error, and the last lines of the log.
 * The home folder reads `~`. Which account sent it is the reports service's
 * to know, from the token the request carries.
 */
export function describeProblem({
  ended,
  error,
  surface,
  version = app.getVersion(),
}: {
  ended?: string;
  error?: string;
  surface: string;
  version?: string;
}): string {
  const lines = [
    `appVersion: ${version}`,
    `platform: ${process.platform} ${process.getSystemVersion()} ${process.arch}`,
    `surface: ${surface}`,
    ...(ended ? [`ended: ${ended}`] : []),
  ];
  if (error) {
    lines.push("", error.trim());
  }
  const tail = readLogTail();
  if (tail.length > 0) {
    lines.push("", "Last log lines:", ...tail);
  }
  return scrubHome(lines.join("\n"));
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

/**
 * What identifies a throw across builds: its first line and top frames, with
 * line and column numbers, bundle chunk hashes and timestamps taken out, so
 * the same bug in two versions is one problem.
 */
export function stackSignature(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const head = (lines[0] ?? "").replace(
    /^\S+ (?=uncaughtException|unhandledRejection)/,
    "",
  );
  const frames = lines.filter((line) => line.startsWith("at ")).slice(0, 3);
  return [head, ...frames]
    .join("\n")
    .replaceAll(/:\d+(:\d+)?/g, "")
    .replaceAll(/-[\w-]{8}\.js/g, ".js")
    .replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "");
}

export function fingerprintOf(signature: string, kind: string) {
  return `${kind}:${createHash("sha256").update(signature).digest("hex").slice(0, 16)}`;
}

/**
 * Sends one report to the reports service and answers its id. A signed-in
 * report carries the account's token, the way every request to us does, so
 * it can be answered; one from someone not signed in goes without.
 */
export async function sendReport(input: ReportInput): Promise<{ id: string }> {
  const base = import.meta.env.MAIN_VITE_REPORTS_BASE_URL;
  if (!base) {
    throw new Error("This build has nowhere to send reports.");
  }
  const response = await fetch(new URL("/reports", base), {
    body: JSON.stringify(input),
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
