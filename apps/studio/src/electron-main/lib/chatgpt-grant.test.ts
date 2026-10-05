import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromPromise } from "xstate";

import { grantMachine, type RefreshOutcome } from "./chatgpt-grant";

const DELAY_MS = 60_000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A grant over fakes: each refresh waits on a promise the test settles, and
 * `session` and `due` stand for what the store says.
 */
function grant({
  due = false,
  session = true,
}: { due?: boolean; session?: boolean } = {}) {
  const world = { due, session };
  const refreshes: ReturnType<typeof deferred<RefreshOutcome>>[] = [];
  const revoke = vi.fn(() => Promise.resolve({ revoked: true }));
  const endSession = vi.fn();
  const delays: number[] = [];
  const actor = createActor(
    grantMachine.provide({
      actions: { endSession },
      actors: {
        refresh: fromPromise<RefreshOutcome, { id: string }>(() => {
          const refresh = deferred<RefreshOutcome>();
          refreshes.push(refresh);
          return refresh.promise;
        }),
        revoke: fromPromise<{ revoked: boolean }, { id: string }>(revoke),
      },
      delays: {
        refreshDelay: ({ context }) => {
          delays.push(context.failures);
          return DELAY_MS;
        },
      },
      guards: {
        hasSession: () => world.session,
        isDue: () => world.due,
      },
    }),
    { input: { id: "account-1" } },
  );
  actor.start();
  const state = () => JSON.stringify(actor.getSnapshot().value);
  return { actor, delays, endSession, refreshes, revoke, state, world };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a ChatGPT grant", () => {
  it("starts active with a session and refreshes when its delay passes", async () => {
    const { refreshes, state } = grant();
    expect(state()).toBe('{"active":"waiting"}');
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(state()).toBe('{"active":"refreshing"}');
    refreshes[0]?.resolve("refreshed");
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toBe('{"active":"waiting"}');
  });

  it("starts signed out without one, and waits for a sign-in", async () => {
    const { actor, refreshes, state } = grant({ session: false });
    expect(state()).toBe('"signedOut"');
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(refreshes).toHaveLength(0);

    actor.send({ type: "signInStarted" });
    expect(state()).toBe('"awaitingCallback"');
    actor.send({ type: "signInEnded" });
    expect(state()).toBe('"signedOut"');

    actor.send({ type: "signInStarted" });
    actor.send({ type: "signedIn" });
    expect(state()).toBe('{"active":"waiting"}');
  });

  // The refresh token rotates: two refreshes out at once spend it twice and
  // lose the session.
  it("runs one refresh at a time however often one is asked for", async () => {
    const { actor, refreshes } = grant();
    actor.send({ type: "refreshDue" });
    actor.send({ type: "refreshDue" });
    actor.send({ type: "woke" });
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshes).toHaveLength(1);
  });

  it("waits out a refresh before signing out, so it revokes the token that came back", async () => {
    const { actor, refreshes, revoke, state } = grant();
    actor.send({ type: "refreshDue" });
    actor.send({ type: "signOut" });
    expect(state()).toBe('{"active":"refreshing"}');
    expect(revoke).not.toHaveBeenCalled();

    refreshes[0]?.resolve("refreshed");
    await vi.advanceTimersByTimeAsync(0);
    expect(revoke).toHaveBeenCalledOnce();
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().output).toEqual({ revoked: true });
  });

  it("signs out at once when no refresh is out", async () => {
    const { actor, revoke } = grant();
    actor.send({ type: "signOut" });
    await vi.advanceTimersByTimeAsync(0);
    expect(revoke).toHaveBeenCalledOnce();
    expect(actor.getSnapshot().status).toBe("done");
  });

  it("ends the session the API refused", () => {
    const { actor, endSession, state } = grant();
    actor.send({ accessToken: "access-1", type: "sessionRefused" });
    expect(endSession).toHaveBeenCalledWith(expect.anything(), {
      accessToken: "access-1",
    });
    expect(state()).toBe('"signedOut"');
  });

  it("is signed out when the server will not refresh it", async () => {
    const { actor, refreshes, state } = grant();
    actor.send({ type: "refreshDue" });
    refreshes[0]?.resolve("ended");
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toBe('"signedOut"');
  });

  it("backs off refreshes that keep failing, and starts over after one lands", async () => {
    const { actor, delays, refreshes } = grant();
    for (const outcome of ["failed", "failed", "refreshed"] as const) {
      actor.send({ type: "refreshDue" });
      refreshes.at(-1)?.resolve(outcome);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(delays).toEqual([0, 1, 2, 0]);
  });

  it("counts a refresh that threw as one that failed", async () => {
    const { actor, delays, refreshes, state } = grant();
    actor.send({ type: "refreshDue" });
    refreshes[0]?.resolve(Promise.reject(new Error("offline")) as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toBe('{"active":"waiting"}');
    expect(delays.at(-1)).toBe(1);
  });

  it("refreshes on waking when due, and otherwise counts its delay again from now", async () => {
    const { actor, refreshes, state, world } = grant();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 1000);
    actor.send({ type: "woke" });
    await vi.advanceTimersByTimeAsync(1000);
    // The timer started over, so the old deadline passed without a refresh.
    expect(refreshes).toHaveLength(0);

    world.due = true;
    actor.send({ type: "woke" });
    expect(state()).toBe('{"active":"refreshing"}');
  });

  it("goes back to waiting when a sign-in lands on an active grant", async () => {
    const { actor, delays, refreshes } = grant();
    actor.send({ type: "refreshDue" });
    refreshes[0]?.resolve("failed");
    await vi.advanceTimersByTimeAsync(0);
    actor.send({ type: "signedIn" });
    expect(delays.at(-1)).toBe(0);
  });
});
