import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureServerEvent, telemetryMock } = vi.hoisted(() => ({
  captureServerEvent: vi.fn(),
  telemetryMock: {
    flush: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    optIn: vi.fn().mockResolvedValue(undefined),
    optOut: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./capture-server-event", () => ({ captureServerEvent }));
vi.mock("./telemetry", () => ({ telemetry: telemetryMock }));
vi.mock("../stores/preferences", () => ({
  getPreferencesStore: () => ({ get: () => true, onDidChange: noop }),
  isDeveloperMode: () => false,
}));

// Test double for the handful of `Electron.App` members this module touches;
// the real interface is far too large to implement.
function createFakeApp(userDataDir: string) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const quit = vi.fn();
  const app = {
    getPath: () => userDataDir,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return app;
    },
    quit,
    whenReady: () => Promise.resolve(),
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  return { app: app as unknown as Electron.App, emit, quit };
}

describe("registerTelemetry", () => {
  let userDataDir: string;
  let lockFilename: string;

  const loadModule = async () => {
    vi.resetModules();
    return import("./register-telemetry");
  };

  const lockExists = async () =>
    fs
      .access(lockFilename)
      .then(() => true)
      .catch(() => false);

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(tmpdir(), "telemetry-test-"));
    lockFilename = path.join(userDataDir, "app.lock");
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { force: true, recursive: true });
  });

  it("clears the crash marker on quit, so the next boot reports a graceful exit", async () => {
    const { finalizeTelemetry, registerTelemetry } = await loadModule();
    const { app } = createFakeApp(userDataDir);

    registerTelemetry(app);
    await vi.waitFor(async () => {
      expect(await lockExists()).toBe(true);
    });

    await finalizeTelemetry();

    expect(await lockExists()).toBe(false);
    expect(captureServerEvent).toHaveBeenCalledWith("app.quit");
    expect(telemetryMock.flush).toHaveBeenCalled();
    expect(telemetryMock.shutdown).toHaveBeenCalled();
  });

  it("reports a non-graceful exit when the marker survived the last session", async () => {
    await fs.writeFile(lockFilename, "running");
    const { registerTelemetry } = await loadModule();

    registerTelemetry(createFakeApp(userDataDir).app);

    await vi.waitFor(() => {
      expect(captureServerEvent).toHaveBeenCalledWith("app.ready", {
        graceful_exit: false,
      });
    });
  });

  it("reports a graceful exit when no marker is left", async () => {
    const { registerTelemetry } = await loadModule();

    registerTelemetry(createFakeApp(userDataDir).app);

    await vi.waitFor(() => {
      expect(captureServerEvent).toHaveBeenCalledWith("app.ready", {
        graceful_exit: true,
      });
    });
  });

  it("tears down once across repeated calls", async () => {
    const { finalizeTelemetry, registerTelemetry } = await loadModule();

    registerTelemetry(createFakeApp(userDataDir).app);
    await Promise.all([finalizeTelemetry(), finalizeTelemetry()]);
    await finalizeTelemetry();

    expect(telemetryMock.shutdown).toHaveBeenCalledTimes(1);
  });

  it("still tears down from will-quit when the app quits before the shutdown path exists", async () => {
    const { registerTelemetry } = await loadModule();
    const { app, emit, quit } = createFakeApp(userDataDir);

    registerTelemetry(app);
    await vi.waitFor(async () => {
      expect(await lockExists()).toBe(true);
    });

    const preventDefault = vi.fn();
    emit("will-quit", { preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    // The quit is resumed last, after the marker is gone and telemetry has
    // flushed, so it is the only settled point to wait on.
    await vi.waitFor(() => {
      expect(quit).toHaveBeenCalled();
    });
    expect(await lockExists()).toBe(false);
  });
});
