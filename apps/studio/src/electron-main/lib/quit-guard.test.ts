import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard is module-level state, so each case gets a fresh copy.
async function loadQuitGuard() {
  vi.resetModules();
  return import("./quit-guard");
}

describe("quit guard", () => {
  let guard: Awaited<ReturnType<typeof loadQuitGuard>>;

  beforeEach(async () => {
    guard = await loadQuitGuard();
  });

  it("approves without a prompt when none is registered", async () => {
    await expect(guard.requestQuitApproval()).resolves.toBe(true);
    expect(guard.isQuitApproved()).toBe(true);
  });

  it("asks once and latches, so a window close and before-quit share one answer", async () => {
    const approval = vi.fn().mockResolvedValue(true);
    guard.setQuitApproval(approval);

    await expect(guard.requestQuitApproval()).resolves.toBe(true);
    await expect(guard.requestQuitApproval()).resolves.toBe(true);

    expect(approval).toHaveBeenCalledTimes(1);
    expect(guard.isQuitApproved()).toBe(true);
  });

  it("shares one prompt between overlapping requests", async () => {
    const approval = vi.fn().mockResolvedValue(true);
    guard.setQuitApproval(approval);

    const [first, second] = await Promise.all([
      guard.requestQuitApproval(),
      guard.requestQuitApproval(),
    ]);

    expect([first, second]).toEqual([true, true]);
    expect(approval).toHaveBeenCalledTimes(1);
  });

  it("asks again after a cancel", async () => {
    const approval = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    guard.setQuitApproval(approval);

    await expect(guard.requestQuitApproval()).resolves.toBe(false);
    expect(guard.isQuitApproved()).toBe(false);

    await expect(guard.requestQuitApproval()).resolves.toBe(true);
    expect(approval).toHaveBeenCalledTimes(2);
  });

  it("fails open when the prompt throws", async () => {
    guard.setQuitApproval(() => Promise.reject(new Error("no dialog")));

    await expect(guard.requestQuitApproval()).resolves.toBe(true);
    expect(guard.isQuitApproved()).toBe(true);
  });
});
