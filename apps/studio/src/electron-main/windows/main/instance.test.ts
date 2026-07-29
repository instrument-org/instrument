import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearMainWindow,
  getOrCreateMainWindow,
  setMainWindow,
} from "./instance";

vi.mock("electron", () => ({
  BrowserWindow: class {
    isDestroyed() {
      return false;
    }
  },
}));

let currentWindow: BrowserWindow | null = null;

afterEach(() => {
  if (currentWindow) {
    clearMainWindow(currentWindow);
    currentWindow = null;
  }
});

describe("getOrCreateMainWindow", () => {
  it("shares an in-flight window creation and stores its result", async () => {
    const mainWindow = new BrowserWindow({});
    currentWindow = mainWindow;
    let resolveCreation: ((window: BrowserWindow) => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<BrowserWindow>((resolve) => {
          resolveCreation = resolve;
        }),
    );

    const first = getOrCreateMainWindow(create);
    const second = getOrCreateMainWindow(create);
    resolveCreation?.(mainWindow);

    await expect(Promise.all([first, second])).resolves.toEqual([
      mainWindow,
      mainWindow,
    ]);
    expect(create).toHaveBeenCalledOnce();
    await expect(getOrCreateMainWindow(create)).resolves.toBe(mainWindow);
    expect(create).toHaveBeenCalledOnce();
  });

  it("returns the existing window without creating another", async () => {
    const mainWindow = new BrowserWindow({});
    currentWindow = mainWindow;
    setMainWindow(mainWindow);
    const create = vi.fn();

    await expect(getOrCreateMainWindow(create)).resolves.toBe(mainWindow);
    expect(create).not.toHaveBeenCalled();
  });

  it("releases a settled creation after its window is cleared", async () => {
    const firstWindow = new BrowserWindow({});
    const secondWindow = new BrowserWindow({});
    currentWindow = secondWindow;
    const create = vi
      .fn<() => Promise<BrowserWindow>>()
      .mockResolvedValueOnce(firstWindow)
      .mockResolvedValueOnce(secondWindow);

    await expect(getOrCreateMainWindow(create)).resolves.toBe(firstWindow);
    clearMainWindow(firstWindow);
    await expect(getOrCreateMainWindow(create)).resolves.toBe(secondWindow);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries after a rejected creation", async () => {
    const mainWindow = new BrowserWindow({});
    currentWindow = mainWindow;
    const failure = new Error("window creation failed");
    const create = vi
      .fn<() => Promise<BrowserWindow>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(mainWindow);

    await expect(getOrCreateMainWindow(create)).rejects.toBe(failure);
    await expect(getOrCreateMainWindow(create)).resolves.toBe(mainWindow);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
