import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromPromise } from "xstate";

import { quitMachine } from "./quit-machine";

// The quit is module-level state, so each case gets a fresh copy.
async function loadQuit() {
  vi.resetModules();
  return import("./quit");
}

describe("requestQuitApproval", () => {
  let quit: Awaited<ReturnType<typeof loadQuit>>;

  beforeEach(async () => {
    quit = await loadQuit();
  });

  it("approves without a prompt before the quit is started", async () => {
    await expect(quit.requestQuitApproval()).resolves.toBe(true);
  });

  it.each([
    [true, true],
    [false, false],
  ])("resolves the prompt's answer %s to %s", async (answer, expected) => {
    quit.startQuit(
      quitMachine.provide({
        actors: { approve: fromPromise(() => Promise.resolve(answer)) },
      }),
    );

    await expect(quit.requestQuitApproval()).resolves.toBe(expected);
    expect(quit.isQuitApproved()).toBe(expected);
  });

  it("shares one prompt between overlapping requests", async () => {
    const approve = vi.fn(() => Promise.resolve(true));
    quit.startQuit(
      quitMachine.provide({ actors: { approve: fromPromise(approve) } }),
    );

    await expect(
      Promise.all([quit.requestQuitApproval(), quit.requestQuitApproval()]),
    ).resolves.toEqual([true, true]);
    await expect(quit.requestQuitApproval()).resolves.toBe(true);
    expect(approve).toHaveBeenCalledOnce();
  });
});
