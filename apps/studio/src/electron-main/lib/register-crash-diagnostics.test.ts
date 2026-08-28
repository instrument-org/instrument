import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCrashDiagnostics } from "./register-crash-diagnostics";

const { addServerException, log } = vi.hoisted(() => ({
  addServerException: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("./electron-logger", () => ({ createScopedLogger: () => log }));
vi.mock("./server-exceptions", () => ({ addServerException }));
vi.mock("../stores/preferences", () => ({ isDeveloperMode: () => false }));

// A real directory, because the crash record is written with real `fs`: the
// point of the record is that it survives a process the logger does not.
let crashDir = "";
const crashRecordPath = () => path.join(crashDir, "last-crash.log");

// Test double for the two `Electron.App` events this module subscribes to; the
// real interface is far too large to implement.
function createFakeApp(userData = crashDir) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const app = {
    getPath: () => userData,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return app;
    },
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  return { app: app as unknown as Electron.App, emit };
}

function createFakeWebContents(type: string) {
  return { getType: () => type, id: 7, isDestroyed: () => false };
}

describe("registerCrashDiagnostics", () => {
  let inheritedMonitor: readonly NodeJS.UncaughtExceptionListener[] = [];
  let inheritedUncaughtCount = 0;
  let inheritedRejection: readonly NodeJS.UnhandledRejectionListener[] = [];

  const addedMonitorListeners = () =>
    process
      .listeners("uncaughtExceptionMonitor")
      .filter((listener) => !inheritedMonitor.includes(listener));

  const addedRejectionListeners = () =>
    process
      .listeners("unhandledRejection")
      .filter((listener) => !inheritedRejection.includes(listener));

  beforeEach(() => {
    vi.clearAllMocks();
    crashDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-diagnostics-"));
    inheritedMonitor = process.listeners("uncaughtExceptionMonitor");
    inheritedUncaughtCount = process.listeners("uncaughtException").length;
    inheritedRejection = process.listeners("unhandledRejection");

    // The handlers attach to the shared process object, so leaving one on
    // would let this test's registration answer the next test's throw.
    return () => {
      for (const listener of addedMonitorListeners()) {
        process.off("uncaughtExceptionMonitor", listener);
      }
      for (const listener of addedRejectionListeners()) {
        process.off("unhandledRejection", listener);
      }
      fs.rmSync(crashDir, { force: true, recursive: true });
    };
  });

  it("records a renderer crash without naming the page it was showing", () => {
    const { app, emit } = createFakeApp();
    registerCrashDiagnostics(app);

    emit("render-process-gone", {}, createFakeWebContents("webview"), {
      exitCode: 133,
      reason: "crashed",
    });

    expect(log.error).toHaveBeenCalledWith(
      "render-process-gone type=webview id=7 reason=crashed exitCode=133",
    );
  });

  it("says so when a renderer that already went away crashed", () => {
    const { app, emit } = createFakeApp();
    registerCrashDiagnostics(app);

    emit(
      "render-process-gone",
      {},
      { ...createFakeWebContents("window"), isDestroyed: () => true },
      { exitCode: 1, reason: "oom" },
    );

    expect(log.error).toHaveBeenCalledWith(
      "render-process-gone type=destroyed reason=oom exitCode=1",
    );
  });

  it("records a child process crash by name", () => {
    const { app, emit } = createFakeApp();
    registerCrashDiagnostics(app);

    emit(
      "child-process-gone",
      {},
      {
        exitCode: 5,
        name: "Network Service",
        reason: "crashed",
        serviceName: "network.mojom.NetworkService",
        type: "Utility",
      },
    );

    expect(log.error).toHaveBeenCalledWith(
      "child-process-gone type=Utility name=Network Service reason=crashed exitCode=5",
    );
  });

  it("falls back to the service name when a child process has no display name", () => {
    const { app, emit } = createFakeApp();
    registerCrashDiagnostics(app);

    emit(
      "child-process-gone",
      {},
      {
        exitCode: 9,
        reason: "killed",
        serviceName: "network.mojom.NetworkService",
        type: "Utility",
      },
    );

    expect(log.error).toHaveBeenCalledWith(
      "child-process-gone type=Utility name=network.mojom.NetworkService reason=killed exitCode=9",
    );
  });

  it.each([
    ["render-process-gone", createFakeWebContents("window")],
    ["child-process-gone", undefined],
  ])(
    "stays quiet about the clean exits %s reports, which every teardown produces",
    (event, webContents) => {
      const { app, emit } = createFakeApp();
      registerCrashDiagnostics(app);

      const details = { exitCode: 0, reason: "clean-exit", type: "Utility" };
      if (webContents) {
        emit(event, {}, webContents, details);
      } else {
        emit(event, {}, details);
      }

      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it("handles process-level errors for every install, whatever the analytics preference", () => {
    registerCrashDiagnostics(createFakeApp().app);

    expect(addedMonitorListeners()).toHaveLength(1);
    expect(addedRejectionListeners()).toHaveLength(1);
  });

  // The distinction the whole module turns on. An `uncaughtException` listener
  // replaces what Node does about a throw; the monitor only watches, so the
  // process still dies and the failure the user hit is the failure that
  // happened.
  it("watches an uncaught throw rather than taking Node's answer to it away", () => {
    registerCrashDiagnostics(createFakeApp().app);

    expect(process.listeners("uncaughtException")).toHaveLength(
      inheritedUncaughtCount,
    );
  });

  it("writes an uncaught throw somewhere a dying process cannot lose it", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("boom");

    // Invoked directly: emitting on the real process would reach the test
    // runner's own handler and fail the run.
    addedMonitorListeners()[0]?.(error, "uncaughtException");

    // Not through the logger, whose file transport queues and never drains on
    // the way out.
    expect(log.error).not.toHaveBeenCalled();
    const record = fs.readFileSync(crashRecordPath(), "utf8");
    expect(record).toContain("uncaughtException:");
    expect(record).toContain("boom");
  });

  it("folds the previous session's crash into this session's log, once", () => {
    fs.writeFileSync(crashRecordPath(), "uncaughtException: from last time\n");

    registerCrashDiagnostics(createFakeApp().app);

    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("from last time"),
    );
    expect(fs.existsSync(crashRecordPath())).toBe(false);

    vi.clearAllMocks();
    registerCrashDiagnostics(createFakeApp().app);
    expect(log.error).not.toHaveBeenCalled();
  });

  // Routine in an app this size, and Node's default is to promote one into an
  // uncaught exception and take the window down with whatever was in it. This
  // is the one handler here that answers rather than watches, so the app is
  // alive afterwards and the logger is the right place for it.
  it("catches an unhandled rejection rather than dying of it", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("nobody awaited this");

    addedRejectionListeners()[0]?.(error, Promise.resolve());

    expect(log.error).toHaveBeenCalledWith(error);
    expect(addServerException).not.toHaveBeenCalled();
    expect(fs.existsSync(crashRecordPath())).toBe(false);
  });
});
