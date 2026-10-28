import { describe, expect, it, vi } from "vitest";

import { waitForDisk } from "./workspace-cleanup";

describe("waitForDisk", () => {
  const GB = 1024 ** 3;

  it("goes ahead at once with room to spare", async () => {
    const onWait = vi.fn();
    await waitForDisk({ free: () => Promise.resolve(50 * GB), onWait });
    expect(onWait).not.toHaveBeenCalled();
  });

  it("says once why it waits, and goes ahead once there is room", async () => {
    const free = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(5 * GB)
      .mockResolvedValueOnce(6 * GB)
      .mockResolvedValue(25 * GB);
    const onWait = vi.fn();
    await waitForDisk({ free, onWait, recheckMs: 1 });
    expect(onWait).toHaveBeenCalledOnce();
    expect(free).toHaveBeenCalledTimes(3);
  });

  it("fails the run once the wait runs out", async () => {
    await expect(
      waitForDisk({
        free: () => Promise.resolve(5 * GB),
        onWait: () => undefined,
        recheckMs: 1,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/Only 5\.0 GB free .* under the 20\.0 GB a case needs/);
  });
});
