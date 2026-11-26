import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return { app: Object.assign(new Emitter(), { quit: vi.fn() }) };
});

const { app } = await import("electron");
const { holdThroughBoot } = await import("./early-window-hold");

const event = () => ({ preventDefault: vi.fn() });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function heldWindow({ isMac = true, onScreen = true } = {}) {
  const window = Object.assign(new EventEmitter(), {
    focus: vi.fn(),
    isDestroyed: () => false,
  });
  const letGo = holdThroughBoot(window, { canFocus: () => onScreen, isMac });
  return { letGo, window };
}

describe("holding the early window through boot", () => {
  it("keeps the window open and a quit waiting until boot lets go, then quits", async () => {
    vi.mocked(app.quit).mockClear();
    const { letGo, window } = heldWindow();

    const close = event();
    window.emit("close", close);
    const quit = event();
    app.emit("before-quit", quit);
    await flush();

    expect(close.preventDefault).toHaveBeenCalled();
    expect(quit.preventDefault).toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();

    letGo();
    await flush();
    expect(app.quit).toHaveBeenCalledOnce();

    // Let go, closes and quits are boot's own to handle.
    const later = event();
    window.emit("close", later);
    app.emit("before-quit", later);
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  it("lets a second quit, and a close after a quit, go ahead while boot holds on", async () => {
    const { letGo, window } = heldWindow();
    const first = event();
    app.emit("before-quit", first);
    const second = event();
    app.emit("before-quit", second);
    const close = event();
    window.emit("close", close);

    expect(first.preventDefault).toHaveBeenCalled();
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(close.preventDefault).not.toHaveBeenCalled();
    letGo();
    await flush();
  });

  it("takes a close outside macOS as asking to quit, so a second close goes ahead", async () => {
    vi.mocked(app.quit).mockClear();
    const { letGo, window } = heldWindow({ isMac: false });
    const first = event();
    window.emit("close", first);
    const second = event();
    window.emit("close", second);

    expect(first.preventDefault).toHaveBeenCalled();
    expect(second.preventDefault).not.toHaveBeenCalled();
    letGo();
    await flush();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("quits after a while when boot never lets go", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      vi.mocked(app.quit).mockClear();
      const { letGo } = heldWindow();
      app.emit("before-quit", event());
      vi.advanceTimersByTime(9_999);
      expect(app.quit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(app.quit).toHaveBeenCalledOnce();
      letGo();
    } finally {
      vi.useRealTimers();
    }
    await flush();
  });

  it("does not quit on letting go when no quit was asked for", async () => {
    vi.mocked(app.quit).mockClear();
    heldWindow().letGo();
    await flush();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it.each([
    { focused: 1, onScreen: true },
    { focused: 0, onScreen: false },
  ])(
    "brings the window forward at a second launch while on screen (on screen: $onScreen)",
    ({ focused, onScreen }) => {
      const { letGo, window } = heldWindow({ onScreen });
      app.emit("second-instance", event(), []);
      letGo();
      app.emit("second-instance", event(), []);
      expect(window.focus).toHaveBeenCalledTimes(focused);
    },
  );
});
