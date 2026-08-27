import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerCrashDiagnostics } from "./register-crash-diagnostics";

const { addServerException, log } = vi.hoisted(() => ({
  addServerException: vi.fn(),
  log: { error: vi.fn() },
}));

vi.mock("./electron-logger", () => ({ createScopedLogger: () => log }));
vi.mock("./server-exceptions", () => ({ addServerException }));
vi.mock("../stores/preferences", () => ({ isDeveloperMode: () => false }));

// Test double for the two `Electron.App` events this module subscribes to; the
// real interface is far too large to implement.
function createFakeApp() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const app = {
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
  let inheritedUncaught: readonly NodeJS.UncaughtExceptionListener[] = [];
  let inheritedRejection: readonly NodeJS.UnhandledRejectionListener[] = [];

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
    inheritedUncaught = process.listeners("uncaughtException");
    inheritedRejection = process.listeners("unhandledRejection");

    // The handlers attach to the shared process object, so leaving one on
    // would let this test's registration answer the next test's throw.
    return () => {
      for (const listener of addedUncaughtListeners()) {
        process.off("uncaughtException", listener);
      }
      for (const listener of addedRejectionListeners()) {
        process.off("unhandledRejection", listener);
      }
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

    expect(addedUncaughtListeners()).toHaveLength(1);
    expect(addedRejectionListeners()).toHaveLength(1);
  });

  it("logs an uncaught throw rather than letting it leave without a record", () => {
    registerCrashDiagnostics(createFakeApp().app);
    const error = new Error("boom");

    // Invoked directly: emitting on the real process would reach the test
    // runner's own handler and fail the run.
    addedUncaughtListeners()[0]?.(error, "uncaughtException");

    expect(log.error).toHaveBeenCalledWith(error);
    expect(addServerException).not.toHaveBeenCalled();
  });
});
