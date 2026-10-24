import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SLOW_INVOCATION_MS, watchSlowInvocation } from "./agent-browser-slow";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function started() {
  return Object.assign(new EventEmitter(), { pid: 4242 });
}

it("logs nothing for an invocation that settles in time", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const settled = watchSlowInvocation("open", started());
  vi.advanceTimersByTime(SLOW_INVOCATION_MS - 1);
  settled();
  vi.advanceTimersByTime(SLOW_INVOCATION_MS);
  expect(warn).not.toHaveBeenCalled();
  expect(info).not.toHaveBeenCalled();
});

it("says a slow invocation's process is still running, then when it finishes", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const settled = watchSlowInvocation("open", started());
  vi.advanceTimersByTime(SLOW_INVOCATION_MS);
  vi.advanceTimersByTime(5000);
  settled();
  expect([...warn.mock.calls, ...info.mock.calls]).toMatchInlineSnapshot(`
    [
      [
        "agent-browser open has not finished after 60s: process 4242 is still running",
      ],
      [
        "agent-browser open finished after 65s",
      ],
    ]
  `);
});

it("says when a slow invocation's process exited but its output stayed open", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const child = started();
  watchSlowInvocation("get", child);
  vi.advanceTimersByTime(1000);
  child.emit("exit");
  vi.advanceTimersByTime(SLOW_INVOCATION_MS - 1000);
  expect(warn.mock.calls).toMatchInlineSnapshot(`
    [
      [
        "agent-browser get has not finished after 60s: its process exited 59s ago and its output is still open",
      ],
    ]
  `);
});
