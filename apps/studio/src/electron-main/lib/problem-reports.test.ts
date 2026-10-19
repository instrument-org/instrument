import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildExceptionEvent,
  type ExceptionEvent,
} from "@instrument-org/shared/exceptions";

import { type EndedSession } from "./problem-reports";

// Loaded fresh for each test, so its store opens in that test's folder.
let reports: typeof import("./problem-reports");

const { electronApp, publish, stored, userData } = vi.hoisted(() => ({
  electronApp: { isPackaged: true },
  publish: vi.fn(),
  stored: { events: [] as ExceptionEvent[] },
  userData: { dir: "" },
}));

vi.mock("./exception-store", () => ({
  listExceptionEvents: () => stored.events,
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => "2.0.5",
    get isPackaged() {
      return electronApp.isPackaged;
    },
  },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: { publish } }));
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({ get: () => false }),
}));
vi.mock("@/electron-main/platform-api/headers", () => ({
  getPlatformApiHeaders: () => ({}),
}));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  // No log in tests, as in development.
  getMainLogFilePath: () => path.join(userData.dir, "logs", "main.log"),
}));

// Electron adds this to Node's process, and these tests run in plain Node.
Object.assign(process, { getSystemVersion: () => "26.1" });

const THROW = [
  "2026-10-09T16:12:04.000Z uncaughtException: Error: EPIPE: broken pipe, write",
  "    at afterWriteDispatched (node:internal/stream_base_commons:161:15)",
  "    at send (/Applications/Instrument.app/Contents/Resources/app.asar/out/main/mac-native-Bq3k9xZa.js:1:18234)",
].join("\n");

const APP = "/Applications/Instrument.app/Contents/Resources/app.asar";

/** The event an uncaught throw leaves in the crash record. */
const crashEvent = (stack = THROW, message = "EPIPE: broken pipe, write") =>
  buildExceptionEvent(
    Object.assign(new Error(message), {
      stack: stack.replace(/^\S+ uncaughtException: /, ""),
    }),
    {
      breadcrumbs: [],
      context: { handled: false, mechanism: "uncaughtException" },
      contexts: {
        app: {
          channel: "latest",
          flavor: "release",
          packaged: true,
          version: "2.0.4",
        },
        culture: { locale: "en-US", timeZone: "UTC" },
        os: { arch: "arm64", platform: "darwin", version: "26.1" },
        process: { rssMb: 400, uptimeMs: 1000 },
        runtime: { chrome: "1", electron: "1", node: "1" },
      },
      defaultArea: "studio",
      paths: { appRoot: APP },
    },
  );

const ended = (overrides: Partial<EndedSession>) =>
  reports.recordEndedSession({
    crashRecord: undefined,
    dumps: 0,
    endedAt: 1_000,
    previousVersion: "2.0.4",
    unclean: true,
    ...overrides,
  });

describe("problem reports", () => {
  beforeEach(async () => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "problem-reports-"));
    vi.resetModules();
    reports = await import("./problem-reports");
    electronApp.isPackaged = true;
    return () => {
      fs.rmSync(userData.dir, { force: true, recursive: true });
    };
  });

  it("leaves a session that exited normally out of the bell, whatever it survived", () => {
    ended({ crashRecord: crashEvent(), dumps: 2, unclean: false });

    expect(reports.listPendingProblems()).toEqual([]);
  });

  it("calls a session that never exited with a throw on record a crash, titled by the throw", () => {
    ended({ crashRecord: crashEvent() });

    const [problem] = reports.listPendingProblems();
    expect(problem).toMatchObject({
      count: 1,
      kind: "crash",
      title: "Error: EPIPE: broken pipe, write",
    });
    expect(problem?.details).toContain("appVersion: 2.0.4");
    expect(problem?.details).toContain(
      "ended: crashed after an uncaught error",
    );
  });

  it("calls a session that never exited with only a crash dump a crash", () => {
    ended({ dumps: 1 });

    expect(reports.listPendingProblems()[0]).toMatchObject({
      kind: "crash",
      title: "Instrument quit unexpectedly",
    });
  });

  it("calls a session that never exited with nothing on record a hang", () => {
    ended({});

    expect(reports.listPendingProblems()[0]).toMatchObject({
      kind: "hang",
      title: "Instrument didn't close properly",
    });
  });

  it("leaves a hang out of the bell in development, where stopping the dev server ends every session", () => {
    electronApp.isPackaged = false;
    ended({});
    ended({ dumps: 1 });

    expect(reports.listPendingProblems()).toMatchObject([{ kind: "crash" }]);
  });

  it("counts the same crash again instead of listing it twice", () => {
    ended({ crashRecord: crashEvent(), endedAt: 1_000 });
    ended({
      crashRecord: crashEvent(
        THROW.replace("1:18234", "1:18990").replace("Bq3k9xZa", "Lm22pQrT"),
      ),
      endedAt: 2_000,
    });

    expect(reports.listPendingProblems()).toMatchObject([
      { count: 2, firstAt: 1_000, lastAt: 2_000 },
    ]);
  });

  it("takes a problem off the list once it's sent or dismissed", () => {
    ended({});
    const [problem] = reports.listPendingProblems();

    reports.clearPendingProblem(problem?.fingerprint ?? "");

    expect(reports.listPendingProblems()).toEqual([]);
    expect(publish).toHaveBeenCalledWith("problems.updated", null);
  });

  it("carries the crash's event first, then the other recent problems", () => {
    const other = crashEvent(
      "x: y\n    at render (/Applications/Instrument.app/Contents/Resources/app.asar/out/main/index.js:1:1)",
      "Cannot render",
    );
    stored.events = [other];
    const crash = crashEvent();

    ended({ crashRecord: crash });

    const [problem] = reports.listPendingProblems();
    expect(problem?.fingerprint).toBe(`crash:${crash.fingerprint}`);
    expect(problem?.events?.map((event) => event.id)).toEqual([
      crash.id,
      other.id,
    ]);
    expect(problem?.details).toContain(
      "The error:\n[studio, uncaughtException, unhandled",
    );
    expect(problem?.details).toContain("Another recent error:");
    expect(problem?.details).toContain("Error: Cannot render");
    stored.events = [];
  });

  it("leaves out the oldest events until the report fits", () => {
    const huge = (index: number) => ({
      ...crashEvent(THROW, `big ${index}`),
      data: { blob: "x".repeat(400_000) },
      fingerprint: `fp${index}`,
      lastAt: index,
    });
    stored.events = [1, 2, 3, 4, 5, 6].map(huge);

    const { details, events } = reports.describeProblem({
      surface: "help-menu",
    });

    // Each is in the details and in the events, so two of the six fit.
    expect(events.map((event) => event.lastAt)).toEqual([6, 5]);
    expect(Buffer.byteLength(JSON.stringify({ details, events }))).toBeLessThan(
      2_000_000,
    );
    stored.events = [];
  });

  it("writes the home folder as ~ in what it sends", () => {
    const event = crashEvent(
      THROW,
      `ENOENT: open '${os.homedir()}/Documents/notes.md'`,
    );
    const { details } = reports.describeProblem({
      lead: event,
      surface: "route-error",
    });

    expect(details).toContain("ENOENT: open '~/Documents/notes.md'");
    expect(details).not.toContain(os.homedir());
  });
});
