import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createDiskQueue, createSaveQueue } from "./live-file";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));
// The log reaches the main process through the window, which a node test has none of.
vi.mock("@/client/lib/logger", () => ({ logger: { error: vi.fn() } }));

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

it("runs a disk queue's tasks in order and goes on past one that throws", async () => {
  const ran: string[] = [];
  const onError = vi.fn();
  const disk = createDiskQueue({ label: "test", onError });
  void disk.run(() => {
    ran.push("load");
    return Promise.resolve();
  });
  void disk.run(() => Promise.reject(new Error("could not write")));
  void disk.run(() => {
    ran.push("stop");
    return Promise.resolve();
  });
  await disk.settled();
  expect(ran).toEqual(["load", "stop"]);
  expect(onError).toHaveBeenCalledWith("could not write");
});

it("covers a read queued while one already waits", async () => {
  const disk = createDiskQueue({ label: "test" });
  const read = vi.fn(() => Promise.resolve());
  disk.pull(read);
  disk.pull(read);
  await disk.settled();
  expect(read).toHaveBeenCalledOnce();
});
