import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createSaveQueue } from "./live-file";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("saves what a save scheduled before a flush settles", async () => {
  const writes: string[] = [];
  let conflicted = false;
  const saves = createSaveQueue({
    label: "test",
    onStatus: vi.fn(),
    save: () => {
      if (!conflicted) {
        // The file changed underneath: merge, then save again shortly.
        conflicted = true;
        writes.push("conflict");
        saves.schedule(100);
        return Promise.resolve();
      }
      writes.push("merged");
      return Promise.resolve();
    },
  });

  saves.schedule();
  // An editor closing: flush, then cancel whatever is still scheduled.
  await saves.flush();
  saves.cancel();
  await vi.runAllTimersAsync();

  expect(writes).toEqual(["conflict", "merged"]);
  expect(await saves.idle()).toBe(true);
});
