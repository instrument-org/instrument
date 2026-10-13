import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLoopbackSignIn,
  type LoopbackSignInFlow,
} from "./loopback-sign-in";

afterEach(() => {
  vi.useRealTimers();
});

/** A sign-in whose result is what came back: the code, or null. */
function echo({ received }: LoopbackSignInFlow) {
  return received.then((params) => params?.get("code") ?? null);
}

function started(options: Parameters<typeof createLoopbackSignIn>[0] = {}) {
  const signIn = createLoopbackSignIn<null | string>(options);
  let state = "";
  const result = signIn.start((flow) => {
    state = flow.state;
    return echo(flow);
  });
  return { result, signIn, state };
}

describe("createLoopbackSignIn", () => {
  it("hands a redirect carrying its state to the waiting sign-in", async () => {
    const { result, signIn, state } = started();
    expect(signIn.isWaiting()).toBe(true);

    const page = signIn.receive(new URLSearchParams({ code: "c", state }));

    await expect(page).resolves.toBe("c");
    await expect(result).resolves.toBe("c");
    expect(signIn.isWaiting()).toBe(false);
    expect(signIn.receive(new URLSearchParams({ state }))).toBeUndefined();
  });

  it.each([
    ["another state", { state: "other" }],
    ["no state", {}],
  ])("turns away a redirect with %s and keeps waiting", (_, query) => {
    const { signIn } = started();
    expect(signIn.receive(new URLSearchParams(query))).toBeUndefined();
    expect(signIn.isWaiting()).toBe(true);
  });

  it("turns away a redirect when nothing is waiting", () => {
    const signIn = createLoopbackSignIn<string>({});
    expect(signIn.receive(new URLSearchParams({ state: "s" }))).toBeUndefined();
  });

  it("ends the waiting sign-in with null when superseded", async () => {
    const { result, signIn } = started();
    signIn.supersede();
    await expect(result).resolves.toBeNull();
    expect(signIn.isWaiting()).toBe(false);
  });

  it("replaces the waiting sign-in when another starts", async () => {
    const { result: first, signIn, state: firstState } = started();
    let state = "";
    const second = signIn.start((flow) => {
      state = flow.state;
      return echo(flow);
    });

    await expect(first).resolves.toBeNull();
    expect(state).not.toBe(firstState);
    expect(
      signIn.receive(new URLSearchParams({ state: firstState })),
    ).toBeUndefined();
    void signIn.receive(new URLSearchParams({ code: "c", state }));
    await expect(second).resolves.toBe("c");
  });

  it("rejects with its own error once the wait runs out", async () => {
    vi.useFakeTimers();
    const { result } = started({
      timedOut: () => new Error("Took too long"),
      timeoutMs: 1000,
    });
    const settled = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await settled).toEqual(new Error("Took too long"));
  });

  it("takes whatever redirect `accepts` lets through", async () => {
    const { result, signIn } = started({
      accepts: (params) => params.has("error"),
    });
    void signIn.receive(new URLSearchParams({ error: "access_denied" }));
    await expect(result).resolves.toBeNull();
  });

  it("settles after the sign-in stops waiting", async () => {
    const seen: boolean[] = [];
    const signIn = createLoopbackSignIn<null | string>({
      onSettled: () => {
        seen.push(signIn.isWaiting());
      },
    });
    const result = signIn.start(echo);
    signIn.supersede();
    await result;
    expect(seen).toEqual([false]);
  });
});
