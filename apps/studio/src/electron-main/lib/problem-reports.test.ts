import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingProblem,
  describeProblem,
  fingerprintOf,
  listPendingProblems,
  recordEndedSession,
  stackSignature,
} from "./problem-reports";

const { publish, userData } = vi.hoisted(() => ({
  publish: vi.fn(),
  userData: { dir: "" },
}));

vi.mock("electron", () => ({
  app: { getPath: () => userData.dir, getVersion: () => "2.0.5" },
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

const ended = (overrides: Partial<Parameters<typeof recordEndedSession>[0]>) =>
  recordEndedSession({
    crashRecord: undefined,
    dumps: 0,
    endedAt: 1_000,
    previousVersion: "2.0.4",
    unclean: true,
    ...overrides,
  });

describe("problem reports", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "problem-reports-"));
    return () => {
      fs.rmSync(userData.dir, { force: true, recursive: true });
    };
  });

  it("leaves a session that exited normally out of the bell, whatever it survived", () => {
    ended({ crashRecord: THROW, dumps: 2, unclean: false });

    expect(listPendingProblems()).toEqual([]);
  });

  it("calls a session that never exited with a throw on record a crash, titled by the throw", () => {
    ended({ crashRecord: THROW });

    const [problem] = listPendingProblems();
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

    expect(listPendingProblems()[0]).toMatchObject({
      kind: "crash",
      title: "Instrument quit unexpectedly",
    });
  });

  it("calls a session that never exited with nothing on record a hang", () => {
    ended({});

    expect(listPendingProblems()[0]).toMatchObject({
      kind: "hang",
      title: "Instrument didn't close properly",
    });
  });

  it("counts the same crash again instead of listing it twice", () => {
    ended({ crashRecord: THROW, endedAt: 1_000 });
    ended({
      crashRecord: THROW.replace("1:18234", "1:18990").replace(
        "Bq3k9xZa",
        "Lm22pQrT",
      ),
      endedAt: 2_000,
    });

    expect(listPendingProblems()).toMatchObject([
      { count: 2, firstAt: 1_000, lastAt: 2_000 },
    ]);
  });

  it("takes a problem off the list once it's sent or dismissed", () => {
    ended({});
    const [problem] = listPendingProblems();

    clearPendingProblem(problem?.fingerprint ?? "");

    expect(listPendingProblems()).toEqual([]);
    expect(publish).toHaveBeenCalledWith("problems.updated", null);
  });

  it("keeps one fingerprint for a throw across builds and line numbers", () => {
    const later = THROW.replace("161:15", "170:3")
      .replace("Bq3k9xZa", "Lm22pQrT")
      .replace("2026-10-09T16:12:04.000Z", "2026-10-11T08:00:00.000Z");

    expect(fingerprintOf(stackSignature(later), "crash")).toBe(
      fingerprintOf(stackSignature(THROW), "crash"),
    );
  });

  it("writes the home folder as ~ in what it sends", () => {
    const details = describeProblem({
      error: `Error: ENOENT: open '${os.homedir()}/Documents/notes.md'`,
      surface: "route-error",
    });

    expect(details).toContain("Error: ENOENT: open '~/Documents/notes.md'");
    expect(details).not.toContain(os.homedir());
  });
});
