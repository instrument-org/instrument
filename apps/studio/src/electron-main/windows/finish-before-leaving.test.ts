import { LEAVING_CHANNEL } from "@/shared/leaving";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ main: undefined as EventEmitter | undefined }));

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  ipc.main = new Emitter();
  return { ipcMain: ipc.main };
});
vi.mock("../lib/electron-logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { finishBeforeLeaving } = await import("./finish-before-leaving");

/** A window that answers each ask after `answerMs`, or never. */
function windowAnswering(id: number, answerMs: number | null) {
  return {
    id,
    isDestroyed: () => false,
    send: (channel: string, token: unknown) => {
      expect(channel).toBe(LEAVING_CHANNEL.ask);
      if (answerMs !== null) {
        setTimeout(() => {
          ipc.main?.emit(LEAVING_CHANNEL.done, { sender: { id } }, token);
        }, answerMs);
      }
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("settles once every window has answered", async () => {
  let settled = false;
  const finishing = finishBeforeLeaving(
    // The two calls only reach `send`, `id` and `isDestroyed`.
    [windowAnswering(1, 10), windowAnswering(2, 50)] as never,
    { deadlineMs: 1000 },
  ).then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(40);
  expect(settled).toBe(true);
  await finishing;
  expect(ipc.main?.listenerCount(LEAVING_CHANNEL.done)).toBe(0);
});

it("goes on at the deadline without a window that never answers", async () => {
  let settled = false;
  void finishBeforeLeaving(
    [windowAnswering(1, 10), windowAnswering(2, null)] as never,
    { deadlineMs: 1000 },
  ).then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
});
