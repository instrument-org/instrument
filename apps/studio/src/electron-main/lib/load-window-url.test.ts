import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadWindowURL } from "./load-window-url";

const { captureServerException, log } = vi.hoisted(() => ({
  captureServerException: vi.fn(),
  log: { error: vi.fn() },
}));

vi.mock("./capture-server-exception", () => ({ captureServerException }));
vi.mock("./electron-logger", () => ({ createScopedLogger: () => log }));

// Test double for the two `Electron.WebContents` members this module touches;
// the real interface is far too large to implement.
function createFakeWebContents(loadResult: Promise<void>) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const webContents = {
    loadURL: vi.fn(() => loadResult),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return webContents;
    },
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };
  return { emit, webContents: webContents as unknown as Electron.WebContents };
}

// Rejections from `loadURL` carry Chromium's error name in `code`, the way
// Electron builds them.
function createLoadError(code: string, errno: number) {
  return Object.assign(new Error(`${code} (${errno}) loading 'stub'`), {
    code,
    errno,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("loadWindowURL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures a renderer that never loads", async () => {
    const failure = createLoadError("ERR_CONNECTION_REFUSED", -102);
    const { webContents } = createFakeWebContents(Promise.reject(failure));

    loadWindowURL(webContents, "http://localhost:5173/renderer/index.html#/");
    await settle();

    expect(captureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        message:
          "Renderer failed to load http://localhost:5173/renderer/index.html#/",
      }),
    );
  });

  it("treats a load superseded by another navigation as routine", async () => {
    const { webContents } = createFakeWebContents(
      Promise.reject(createLoadError("ERR_ABORTED", -3)),
    );

    loadWindowURL(webContents, "http://localhost:5173/renderer/index.html#/");
    await settle();

    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("logs a main-frame load failure with its code and URL", async () => {
    const { emit, webContents } = createFakeWebContents(Promise.resolve());

    loadWindowURL(webContents, "http://localhost:5173/renderer/index.html#/");
    emit(
      "did-fail-load",
      {},
      -102,
      "ERR_CONNECTION_REFUSED",
      "http://localhost:5173/renderer/index.html#/",
      true,
    );
    await settle();

    expect(log.error).toHaveBeenCalledWith(
      "did-fail-load http://localhost:5173/renderer/index.html#/: ERR_CONNECTION_REFUSED (-102)",
    );
  });

  it.each([
    ["an aborted load", -3, "ERR_ABORTED", true],
    ["a subframe failure", -102, "ERR_CONNECTION_REFUSED", false],
  ])(
    "stays quiet about %s",
    async (_label, errorCode, description, isMainFrame) => {
      const { emit, webContents } = createFakeWebContents(Promise.resolve());

      loadWindowURL(webContents, "http://localhost:5173/renderer/index.html#/");
      emit(
        "did-fail-load",
        {},
        errorCode,
        description,
        "stub://url",
        isMainFrame,
      );
      await settle();

      expect(log.error).not.toHaveBeenCalled();
    },
  );
});
