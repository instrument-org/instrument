import { type ConnectOutcome } from "@/shared/connect-outcome";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type ConnectResult, useConnectFlow } from "./use-connect-flow";

/** A run whose answers the test hands out by hand, one per attempt. */
function controlledRun() {
  const pending: {
    resolve: (result: ConnectResult) => void;
    signal: AbortSignal;
    onPhase: (phase: "checking" | "idle" | "signing-in") => void;
  }[] = [];
  const run = vi.fn(
    (
      _input: undefined,
      attempt: {
        onPhase: (phase: "checking" | "idle" | "signing-in") => void;
        signal: AbortSignal;
      },
    ) =>
      new Promise<ConnectResult>((resolve) => {
        pending.push({ ...attempt, resolve });
      }),
  );
  const answer = (index: number, outcome: ConnectOutcome) => {
    pending[index]?.resolve({ outcome });
  };
  return { answer, pending, run };
}

function setup() {
  const { answer, pending, run } = controlledRun();
  const onCancel = vi.fn();
  const hook = renderHook(() => useConnectFlow({ onCancel, run }));
  return { answer, hook, onCancel, pending };
}

describe("useConnectFlow", () => {
  it("waits, moves to checking, and lands the answer", async () => {
    const { answer, hook, pending } = setup();
    let started!: Promise<ConnectResult | undefined>;
    act(() => {
      started = hook.result.current.start(undefined);
    });
    expect(hook.result.current).toMatchObject({
      phase: "signing-in",
      waiting: true,
    });
    act(() => {
      pending[0]?.onPhase("checking");
    });
    expect(hook.result.current.phase).toBe("checking");
    await act(async () => {
      answer(0, { kind: "no-plan" });
      await started;
    });
    expect(hook.result.current).toMatchObject({
      outcome: { kind: "no-plan" },
      phase: "idle",
      waiting: false,
    });
  });

  it("drops an answer that lands after a newer attempt started", async () => {
    const { answer, hook, pending } = setup();
    let first!: Promise<ConnectResult | undefined>;
    let second!: Promise<ConnectResult | undefined>;
    act(() => {
      first = hook.result.current.start(undefined);
    });
    act(() => {
      second = hook.result.current.start(undefined);
    });
    expect(pending[0]?.signal.aborted).toBe(true);
    await act(async () => {
      answer(0, { kind: "ready" });
      await expect(first).resolves.toBeUndefined();
    });
    // The newer attempt still waits, untouched by the older answer.
    expect(hook.result.current).toMatchObject({
      outcome: undefined,
      waiting: true,
    });
    await act(async () => {
      answer(1, { kind: "out-of-usage" });
      await second;
    });
    expect(hook.result.current.outcome).toEqual({ kind: "out-of-usage" });
  });

  it("drops an answer that lands after a cancel, and tells the provider", async () => {
    const { answer, hook, onCancel, pending } = setup();
    let started!: Promise<ConnectResult | undefined>;
    act(() => {
      started = hook.result.current.start(undefined);
      pending[0]?.onPhase("checking");
    });
    act(() => {
      hook.result.current.cancel();
    });
    expect(onCancel).toHaveBeenCalledWith("checking");
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(hook.result.current.waiting).toBe(false);
    await act(async () => {
      answer(0, { kind: "ready" });
      await expect(started).resolves.toEqual({
        outcome: { kind: "canceled" },
      });
    });
    expect(hook.result.current.outcome).toBeUndefined();
  });

  it("drops an answer that lands after its surface unmounted", async () => {
    const { answer, hook, pending } = setup();
    let started!: Promise<ConnectResult | undefined>;
    act(() => {
      started = hook.result.current.start(undefined);
    });
    hook.unmount();
    expect(pending[0]?.signal.aborted).toBe(true);
    answer(0, { kind: "ready" });
    await expect(started).resolves.toBeUndefined();
  });

  it("stops waiting when a retry on the same page lands the same answer", async () => {
    const { answer, hook } = setup();
    for (const index of [0, 1]) {
      let started!: Promise<ConnectResult | undefined>;
      act(() => {
        started = hook.result.current.start(undefined);
      });
      expect(hook.result.current.waiting).toBe(true);
      // A retry clears the answer it is retrying.
      expect(hook.result.current.outcome).toBeUndefined();
      await act(async () => {
        answer(index, { kind: "no-plan" });
        await started;
      });
      expect(hook.result.current).toMatchObject({
        outcome: { kind: "no-plan" },
        waiting: false,
      });
    }
  });

  it("keeps each way in's answer to itself", async () => {
    const chatgpt = setup();
    const claude = setup();
    let started!: Promise<ConnectResult | undefined>;
    act(() => {
      started = chatgpt.hook.result.current.start(undefined);
    });
    await act(async () => {
      chatgpt.answer(0, { kind: "out-of-usage" });
      await started;
    });
    expect(chatgpt.hook.result.current.outcome).toEqual({
      kind: "out-of-usage",
    });
    expect(claude.hook.result.current.outcome).toBeUndefined();
    act(() => {
      chatgpt.hook.result.current.reset();
    });
    expect(chatgpt.hook.result.current.outcome).toBeUndefined();
  });

  it("reads a run that throws as failed", async () => {
    const onCancel = vi.fn();
    const hook = renderHook(() =>
      useConnectFlow({
        onCancel,
        run: () => Promise.reject(new Error("no callback server")),
      }),
    );
    await act(async () => {
      await hook.result.current.start(undefined);
    });
    expect(hook.result.current.outcome).toEqual({
      kind: "failed",
      message: "no callback server",
    });
  });
});
