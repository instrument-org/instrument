import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCrashDiagnostics } from "./register-crash-diagnostics";

const { captureServerException, log } = vi.hoisted(() => ({
  captureServerException: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock("./electron-logger", () => ({ createScopedLogger: () => log }));
vi.mock("./capture-server-exception", () => ({ captureServerException }));

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
  let inheritedUncaught: readonly NodeJS.UncaughtExceptionListener[] = [];
  let inheritedRejection: readonly NodeJS.UnhandledRejectionListener[] = [];

  const addedMonitorListeners = () =>
    process
      .listeners("uncaughtExceptionMonitor")
      .filter((listener) => !inheritedMonitor.includes(listener));

  const addedUncaughtListeners = () =>
    process
      .listeners("uncaughtException")
      .filter((listener) => !inheritedUncaught.includes(listener));

  const addedRejectionListeners = () =>
    process
      .listeners("unhandledRejection")
      .filter((listener) => !inheritedRejection.includes(listener));

  beforeEach(() => {
    vi.clearAllMocks();
    crashDir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-diagnostics-"));
    inheritedMonitor = process.listeners("uncaughtExceptionMonitor");
    inheritedUncaught = process.listeners("uncaughtException");
    inheritedRejection = process.listeners("unhandledRejection");

    // The handlers attach to the shared process object, so leaving one on
    // would let this test's registration answer the next test's throw.
    return () => {
      for (const listener of addedMonitorListeners()) {
        process.off("uncaughtExceptionMonitor", listener);
      }
      for (const listener of addedUncaughtListeners()) {
        process.off("uncaughtException", listener);
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
    expect(addedUncaughtListeners()).toHaveLength(1);
    expect(addedRejectionListeners()).toHaveLength(1);
  });

  // Electron's own listener shows an error dialog only while it is the sole
  // `uncaughtException` listener, and never exits, so this one is what keeps a
  // main-process throw quiet for the user.
  it("reports an uncaught throw with the app's identity", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("boom");

    // Invoked directly: emitting on the real process would reach the test
    // runner's own handler and fail the run.
    addedUncaughtListeners()[0]?.(error, "uncaughtException");

    expect(captureServerException).toHaveBeenCalledWith(error, {
      origin: "uncaughtException",
      scopes: ["studio"],
    });
  });

  // A throw from an `uncaughtException` listener ends the process.
  it("survives a report that throws", () => {
    registerCrashDiagnostics(createFakeApp().app);
    captureServerException.mockImplementationOnce(() => {
      throw new Error("telemetry is down");
    });

    expect(() =>
      addedUncaughtListeners()[0]?.(new Error("boom"), "uncaughtException"),
    ).not.toThrow();
  });

  // A dependency that downloads through Electron's `net` without an error
  // listener turns a dropped connection into an uncaught throw.
  it.each([
    ["uncaughtException", "net::ERR_NAME_NOT_RESOLVED"],
    ["uncaughtException", "net::ERR_NETWORK_CHANGED"],
    ["uncaughtException", "net::ERR_CONNECTION_RESET"],
    ["unhandledRejection", "net::ERR_INTERNET_DISCONNECTED"],
  ] as const)(
    "logs rather than reports a network drop delivered by %s: %s",
    (origin, message) => {
      registerCrashDiagnostics(createFakeApp().app);
      const error = new Error(message);

      if (origin === "uncaughtException") {
        addedUncaughtListeners()[0]?.(error, origin);
      } else {
        addedRejectionListeners()[0]?.(error, Promise.resolve());
      }

      expect(captureServerException).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        `${origin} from a network failure`,
        error,
      );
    },
  );

  it.each([
    ["a message that only mentions the network stack", "failed: net::ERR_X"],
    ["an unrelated failure", "Cannot read properties of undefined"],
  ])("still reports %s", (_label, message) => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error(message);

    addedUncaughtListeners()[0]?.(error, "uncaughtException");

    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ origin: "uncaughtException" }),
    );
  });

  it("writes an uncaught throw somewhere a quit cannot lose it", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("boom");

    addedMonitorListeners()[0]?.(error, "uncaughtException");

    // Not through the logger, whose file transport queues and never drains on
    // the way out.
    expect(log.error).not.toHaveBeenCalled();
    const record = fs.readFileSync(crashRecordPath(), "utf8");
    expect(record).toContain("uncaughtException:");
    expect(record).toContain("boom");
  });

  it("keeps a network drop out of the crash record", () => {
    registerCrashDiagnostics(createFakeApp().app);

    addedMonitorListeners()[0]?.(
      new Error("net::ERR_NETWORK_CHANGED"),
      "uncaughtException",
    );

    expect(fs.existsSync(crashRecordPath())).toBe(false);
  });

  it("folds the previous session's crash into this session's log, once", () => {
    fs.writeFileSync(crashRecordPath(), "uncaughtException: from last time\n");

    registerCrashDiagnostics(createFakeApp().app);

    expect(log.error).toHaveBeenCalledWith(
      "Previous session hit an uncaught exception:\nuncaughtException: from last time",
    );
    expect(fs.existsSync(crashRecordPath())).toBe(false);

    vi.clearAllMocks();
    registerCrashDiagnostics(createFakeApp().app);
    expect(log.error).not.toHaveBeenCalled();
  });

  // Routine in an app this size, and Node's default is to promote one into an
  // uncaught exception.
  it("reports an unhandled rejection without a crash record", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("nobody awaited this");

    addedRejectionListeners()[0]?.(error, Promise.resolve());

    expect(captureServerException).toHaveBeenCalledWith(error, {
      origin: "unhandledRejection",
      scopes: ["studio"],
    });
    expect(fs.existsSync(crashRecordPath())).toBe(false);
  });
});
