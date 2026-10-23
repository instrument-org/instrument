import { whenWindowSeen } from "@/client/lib/window-seen";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let focused = true;

beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function leave() {
  focused = false;
  window.dispatchEvent(new Event("blur"));
}

function comeBack() {
  focused = true;
  window.dispatchEvent(new Event("focus"));
}

describe("whenWindowSeen", () => {
  it("runs at once in a focused window", () => {
    const run = vi.fn();
    whenWindowSeen(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for an unfocused window to take focus", () => {
    leave();
    const run = vi.fn();
    whenWindowSeen(run);
    expect(run).not.toHaveBeenCalled();
    comeBack();
    expect(run).toHaveBeenCalledTimes(1);
    leave();
    comeBack();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run once stopped", () => {
    leave();
    const run = vi.fn();
    whenWindowSeen(run)();
    comeBack();
    expect(run).not.toHaveBeenCalled();
  });
});
