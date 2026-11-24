import { captureException } from "@/client/lib/capture-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keepListening } from "./keep-listening";

vi.mock("@/client/lib/capture-exception", () => ({
  captureException: vi.fn(),
}));

const controllers: AbortController[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.abort();
  }
  vi.useRealTimers();
});

/** Listens to streams that each send what `streams` says, then end or throw. */
function listen(
  streams: (number | Error)[][],
  onEach: (sent: number) => Promise<void> | void,
) {
  const controller = new AbortController();
  controllers.push(controller);
  let opened = 0;
  void keepListening<number>({
    onEach,
    signal: controller.signal,
    start: async () => {
      const sends = streams[opened] ?? [];
      opened += 1;
      return (async function* () {
        for (const send of sends) {
          if (send instanceof Error) {
            throw send;
          }
          yield send;
        }
      })();
    },
  });
  return { controller, opened: () => opened };
}

describe("keepListening", () => {
  it.each([
    ["ends", [1], 0],
    ["fails", [1, new Error("reset")], 1],
  ])("opens a stream that %s again", async (_case, first, reported) => {
    const heard: number[] = [];
    listen([first, [2]], (sent) => {
      heard.push(sent);
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(heard).toEqual([1, 2]);
    expect(captureException).toHaveBeenCalledTimes(reported);
  });

  it("goes on past one that could not be handled", async () => {
    const heard: number[] = [];
    const { opened } = listen([[1, 2]], (sent) => {
      if (sent === 1) {
        throw new Error("no");
      }
      heard.push(sent);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([2]);
    expect(opened()).toBe(1);
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("stops when aborted", async () => {
    const { controller, opened } = listen([[1]], () => {});
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect(opened()).toBe(1);
  });
});
