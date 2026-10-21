import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appEvents = await vi.hoisted(async () => {
  const events = await import("node:events");
  return new events.EventEmitter();
});
vi.mock("electron", () => ({ app: appEvents }));

const setWindowState = vi.hoisted(() => vi.fn());
vi.mock("@/electron-main/stores/workspace/window-state", () => ({
  isWindowBoundsVisible: () => true,
  rememberWorkAreaFromMaximized: () => {},
  setWindowState,
  shrinkBelowAutoMaximize: (bounds: unknown) => bounds,
}));

const { trackWindowBounds } = await import("./window-bounds");

// Setup opens the app window at a size of its own. That size must never
// become the one the window comes back to, whichever way the window goes
// while setup is up: a resize or move, a close, or a quit.

function fakeWindow() {
  const events = new EventEmitter();
  let bounds = { height: 720, width: 1080, x: 100, y: 80 };
  return {
    events,
    resize(next: typeof bounds) {
      bounds = next;
    },
    window: {
      getBounds: () => bounds,
      isFullScreen: () => false,
      isMaximized: () => false,
      isMinimized: () => false,
      on: (event: string, listener: () => void) => {
        events.on(event, listener);
      },
    },
  };
}

beforeEach(() => {
  setWindowState.mockClear();
  appEvents.removeAllListeners();
});

describe("trackWindowBounds", () => {
  it.each([
    [
      "the window closes",
      (f: ReturnType<typeof fakeWindow>) => f.events.emit("close"),
    ],
    [
      "the window is gone",
      (f: ReturnType<typeof fakeWindow>) => f.events.emit("closed"),
    ],
    ["the app quits", () => appEvents.emit("before-quit")],
  ])("saves nothing while held when %s", (_, end) => {
    const fake = fakeWindow();
    const tracked = trackWindowBounds(fake.window, "app", {
      isHeld: () => true,
    });
    tracked.saveNow();
    end(fake);
    expect(setWindowState).not.toHaveBeenCalled();
  });

  it("saves nothing settled while held, even once held no more", () => {
    vi.useFakeTimers();
    let held = true;
    const fake = fakeWindow();
    const tracked = trackWindowBounds(fake.window, "app", {
      isHeld: () => held,
    });
    tracked.saveSoon();
    vi.advanceTimersByTime(1000);
    expect(setWindowState).not.toHaveBeenCalled();

    held = false;
    fake.resize({ height: 840, width: 1240, x: 20, y: 20 });
    fake.events.emit("close");
    expect(setWindowState).toHaveBeenCalledWith("app", {
      bounds: { height: 840, width: 1240, x: 20, y: 20 },
      isMaximized: false,
    });
    vi.useRealTimers();
  });

  it("saves on close and quit when nothing holds it", () => {
    const fake = fakeWindow();
    trackWindowBounds(fake.window, "app");
    fake.events.emit("close");
    appEvents.emit("before-quit");
    expect(setWindowState).toHaveBeenCalledTimes(2);
  });
});
