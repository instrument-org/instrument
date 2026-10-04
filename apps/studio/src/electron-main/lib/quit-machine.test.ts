import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromPromise } from "xstate";

import { BROWSER_SESSIONS_CLOSE_MS, quitMachine } from "./quit-machine";

const TEARDOWN_MS = 10_000;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function createHarness({
  approve = () => Promise.resolve(true),
  closeBrowserSessions = () => Promise.resolve(),
  finalizeTelemetry = () => Promise.resolve(),
  stopServices = () => Promise.resolve(),
}: {
  approve?: () => Promise<boolean>;
  closeBrowserSessions?: () => Promise<void>;
  finalizeTelemetry?: () => Promise<void>;
  stopServices?: () => Promise<void>;
} = {}) {
  const calls: string[] = [];
  const approveSpy = vi.fn(approve);
  const stopServicesSpy = vi.fn(stopServices);
  const actor = createActor(
    quitMachine.provide({
      actions: {
        exit: () => calls.push("exit"),
        reportBrowserSessionsTimeout: () =>
          calls.push("browser sessions timed out"),
        reveal: () => calls.push("reveal"),
        teardownBrowserViews: () => calls.push("teardown browser views"),
      },
      actors: {
        approve: fromPromise(approveSpy),
        closeBrowserSessions: fromPromise(closeBrowserSessions),
        finalizeTelemetry: fromPromise(finalizeTelemetry),
        stopServices: fromPromise(stopServicesSpy),
      },
      delays: { teardown: TEARDOWN_MS },
    }),
  ).start();
  return {
    actor,
    approve: approveSpy,
    calls,
    send: (
      type: "approvalRequested" | "approvalWithdrawn" | "quitRequested",
    ) => {
      actor.send({ type });
    },
    stopServices: stopServicesSpy,
    value: () => actor.getSnapshot().value,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quit machine", () => {
  it("asks, tears down, and exits on one quit", async () => {
    const h = createHarness();
    h.send("quitRequested");
    await vi.runAllTimersAsync();

    expect(h.calls).toEqual(["teardown browser views", "exit"]);
    expect(h.actor.getSnapshot().status).toBe("done");
  });

  it("asks once and latches, so a window close and before-quit share one answer", async () => {
    const h = createHarness();
    h.send("approvalRequested");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.value()).toBe("approved");

    h.send("approvalRequested");
    h.send("quitRequested");
    await vi.runAllTimersAsync();

    expect(h.approve).toHaveBeenCalledOnce();
    expect(h.calls).toContain("exit");
  });

  it("shares one prompt between a window close and a before-quit that overlap", async () => {
    const answer = deferred<boolean>();
    const h = createHarness({ approve: () => answer.promise });
    h.send("approvalRequested");
    h.send("quitRequested");
    answer.resolve(true);
    await vi.runAllTimersAsync();

    expect(h.approve).toHaveBeenCalledOnce();
    expect(h.calls).toContain("exit");
  });

  it("returns to idle on a cancel and reveals a window for a canceled quit", async () => {
    const h = createHarness({
      approve: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
    });
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.value()).toBe("idle");
    expect(h.calls).toEqual(["reveal"]);

    h.send("quitRequested");
    await vi.runAllTimersAsync();
    expect(h.approve).toHaveBeenCalledTimes(2);
    expect(h.calls).toContain("exit");
  });

  it("asks again once an approval is withdrawn", async () => {
    const h = createHarness();
    h.send("approvalRequested");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.value()).toBe("approved");

    h.send("approvalWithdrawn");
    expect(h.value()).toBe("idle");

    h.send("quitRequested");
    await vi.runAllTimersAsync();
    expect(h.approve).toHaveBeenCalledTimes(2);
    expect(h.calls).toContain("exit");
  });

  it("does not reveal a window when only approval was asked", async () => {
    const h = createHarness({ approve: () => Promise.resolve(false) });
    h.send("approvalRequested");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.value()).toBe("idle");
    expect(h.calls).toEqual([]);
  });

  it("fails open when the prompt throws", async () => {
    const h = createHarness({
      approve: () => Promise.reject(new Error("no dialog")),
    });
    h.send("approvalRequested");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.actor.getSnapshot().hasTag("approved")).toBe(true);
  });

  it("ignores a second quit during teardown", async () => {
    const services = deferred();
    const h = createHarness({ stopServices: () => services.promise });
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(0);
    h.send("quitRequested");
    h.send("approvalRequested");
    services.resolve();
    await vi.runAllTimersAsync();

    expect(h.approve).toHaveBeenCalledOnce();
    expect(h.stopServices).toHaveBeenCalledOnce();
    expect(h.calls.filter((call) => call === "exit")).toHaveLength(1);
  });

  it("moves on when closing browser sessions hangs", async () => {
    const h = createHarness({
      closeBrowserSessions: () => new Promise(() => {}),
    });
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(BROWSER_SESSIONS_CLOSE_MS);

    expect(h.calls).toEqual([
      "browser sessions timed out",
      "teardown browser views",
      "exit",
    ]);
  });

  it("waits for telemetry before exiting", async () => {
    const telemetry = deferred();
    const h = createHarness({ finalizeTelemetry: () => telemetry.promise });
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toEqual(["teardown browser views"]);

    telemetry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls).toEqual(["teardown browser views", "exit"]);
  });

  it.each([
    ["the services", { stopServices: () => new Promise<void>(() => {}) }],
    ["telemetry", { finalizeTelemetry: () => new Promise<void>(() => {}) }],
  ])("still exits on the deadline when %s hang", async (_label, hung) => {
    const h = createHarness(hung);
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(TEARDOWN_MS - 1);
    expect(h.calls).not.toContain("exit");

    await vi.advanceTimersByTimeAsync(1);
    expect(h.calls).toContain("exit");
  });

  it("goes on when a teardown step fails", async () => {
    const h = createHarness({
      closeBrowserSessions: () => Promise.reject(new Error("boom")),
      stopServices: () => Promise.reject(new Error("boom")),
    });
    h.send("quitRequested");
    await vi.advanceTimersByTimeAsync(0);

    expect(h.calls).toEqual(["teardown browser views", "exit"]);
  });
});
