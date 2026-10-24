import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  finishOnWeb: { call: vi.fn() },
  signInSocial: { call: vi.fn() },
}));

const openWebsite = vi.hoisted(() => vi.fn());

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    auth: { ...auth, cancelSignIn: { call: vi.fn() } },
    billing: { openWebsite: { call: openWebsite } },
  },
}));

import { type ConnectResult } from "./use-connect-flow";
import { useInstrumentConnect } from "./use-connect";

describe("useInstrumentConnect", () => {
  it.each([
    ["signed-in", { kind: "ready" }],
    ["use-subscription", { kind: "ready", next: "subscriptions" }],
  ])("waits on the website, then answers %s as %o", async (back, expected) => {
    auth.signInSocial.call.mockResolvedValue("on-web");
    let finish!: (value: string) => void;
    auth.finishOnWeb.call.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const hook = renderHook(() => useInstrumentConnect());
    let started!: Promise<ConnectResult | undefined>;
    await act(async () => {
      started = hook.result.current.start();
      await Promise.resolve();
    });
    expect(hook.result.current).toMatchObject({
      phase: "on-web",
      waiting: true,
    });
    await act(async () => {
      finish(back);
      await started;
    });
    expect(hook.result.current.outcome).toEqual(expected);
  });

  it("answers a sign-in the app ends itself as ready, with no wait", async () => {
    auth.signInSocial.call.mockResolvedValue("signed-in");
    auth.finishOnWeb.call.mockClear();
    const hook = renderHook(() => useInstrumentConnect());
    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.outcome).toEqual({ kind: "ready" });
    expect(auth.finishOnWeb.call).not.toHaveBeenCalled();
  });

  it("sends an account already signed in to the website's plans, and waits there", async () => {
    auth.signInSocial.call.mockClear();
    openWebsite.mockResolvedValue(undefined);
    auth.finishOnWeb.call.mockResolvedValue("signed-in");
    const hook = renderHook(() => useInstrumentConnect());
    await act(async () => {
      await hook.result.current.start({ plans: true });
    });
    expect(openWebsite).toHaveBeenCalledWith({ page: "plans", wait: true });
    expect(auth.signInSocial.call).not.toHaveBeenCalled();
    expect(hook.result.current.outcome).toEqual({ kind: "ready" });
  });
});
