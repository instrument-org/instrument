import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromPromise } from "xstate";

import { quitMachine } from "./quit-machine";

const runningWork = () =>
  Promise.resolve({ agents: 0, dictating: false, jobs: 0 });

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
      { runningWork },
    );

    await expect(quit.requestQuitApproval()).resolves.toBe(expected);
    expect(quit.isQuitApproved()).toBe(expected);
  });

  it("shares one prompt between overlapping requests", async () => {
    const approve = vi.fn(() => Promise.resolve(true));
    quit.startQuit(
      quitMachine.provide({ actors: { approve: fromPromise(approve) } }),
      { runningWork },
    );

    await expect(
      Promise.all([quit.requestQuitApproval(), quit.requestQuitApproval()]),
    ).resolves.toEqual([true, true]);
    await expect(quit.requestQuitApproval()).resolves.toBe(true);
    expect(approve).toHaveBeenCalledOnce();
  });
});

describe("a quit the app decides on alone", () => {
  let quit: Awaited<ReturnType<typeof loadQuit>>;

  beforeEach(async () => {
    quit = await loadQuit();
  });

  it("approves without the prompt, and a later close goes ahead", async () => {
    const approve = vi.fn(() => Promise.resolve(false));
    quit.startQuit(
      quitMachine.provide({ actors: { approve: fromPromise(approve) } }),
      { runningWork },
    );
    expect(quit.approveQuitQuietly()).toBe(true);
    await expect(quit.requestQuitApproval()).resolves.toBe(true);
    expect(approve).not.toHaveBeenCalled();

    quit.withdrawQuitApproval();
    expect(quit.isQuitApproved()).toBe(false);
  });

  it("leaves a prompt already open to the person answering it", () => {
    quit.startQuit(
      quitMachine.provide({
        actors: { approve: fromPromise(() => new Promise<boolean>(() => {})) },
      }),
      { runningWork },
    );
    void quit.requestQuitApproval();
    expect(quit.approveQuitQuietly()).toBe(false);
  });

  it.each([
    ["nothing running", { agents: 0, dictating: false, jobs: 0 }, "idle"],
    ["an agent", { agents: 1, dictating: false, jobs: 0 }, "busy"],
    ["a job", { agents: 0, dictating: false, jobs: 2 }, "busy"],
    ["dictation", { agents: 0, dictating: true, jobs: 0 }, "busy"],
  ] as const)("reads %s as %s", async (_, work, expected) => {
    quit.startQuit(quitMachine, { runningWork: () => Promise.resolve(work) });
    await expect(quit.readRunningWork()).resolves.toBe(expected);
  });

  it("reads work it cannot count as unknown", async () => {
    await expect(quit.readRunningWork()).resolves.toBe("unknown");
    quit.startQuit(quitMachine, {
      runningWork: () => Promise.reject(new Error("no workspace")),
    });
    await expect(quit.readRunningWork()).resolves.toBe("unknown");
  });
});
