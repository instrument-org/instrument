import { type ClaudeCodeSignIn } from "@instrument-org/ai-gateway";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor, fromPromise } from "xstate";

import { claudeSignInMachine } from "./claude-sign-in";

const TIMEOUT_MS = 1000;

/** A sign-in process whose completion the test settles. */
function fakeSignIn(name: string) {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const completion = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const signIn: ClaudeCodeSignIn = {
    cancel: vi.fn(() => {
      fail(new Error("canceled"));
    }),
    completion,
    linkForAnotherDevice: `https://claude.ai/${name}`,
    submitCode: vi.fn(() => Promise.resolve()),
    url: `http://localhost/${name}`,
  };
  return { fail, finish, signIn };
}

function signInActor() {
  const log: string[] = [];
  const restarted = fakeSignIn("restarted");
  let restart = (): Promise<ClaudeCodeSignIn> =>
    Promise.resolve(restarted.signIn);
  const actor = createActor(
    claudeSignInMachine.provide({
      actions: {
        cancelSignIn: (_, { signIn }) => {
          log.push(`cancel ${signIn?.linkForAnotherDevice ?? "nothing"}`);
          signIn?.cancel();
        },
        ended: () => log.push("ended"),
        landed: () => log.push("landed"),
      },
      actors: {
        restart: fromPromise(() => restart()),
      },
      delays: { signInTimeout: TIMEOUT_MS },
    }),
  );
  actor.start();
  const view = () => {
    const snapshot = actor.getSnapshot();
    return {
      link: snapshot.context.signIn?.linkForAnotherDevice,
      log: log.splice(0),
      state: JSON.stringify(snapshot.value),
    };
  };
  const start = (name: string) => {
    const started = fakeSignIn(name);
    actor.send({
      executablePath: "/claude",
      signIn: started.signIn,
      type: "started",
    });
    return started;
  };
  return {
    actor,
    failRestart: () => {
      restart = () => Promise.reject(new Error("would not start"));
    },
    start,
    view,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("claudeSignInMachine", () => {
  it("waits on a started sign-in and lands when Claude Code stores it", async () => {
    const { start, view } = signInActor();
    const { finish } = start("first");
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": "https://claude.ai/first",
        "log": [
          "cancel nothing",
        ],
        "state": "{"waiting":"open"}",
      }
    `);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": undefined,
        "log": [
          "landed",
          "ended",
        ],
        "state": ""idle"",
      }
    `);
  });

  it.each([
    [
      "canceled in the app",
      (actor: ReturnType<typeof signInActor>["actor"]) => {
        actor.send({ type: "cancel" });
        return Promise.resolve();
      },
    ],
    [
      "timed out",
      async () => {
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      },
    ],
  ])("ends the process when %s", async (_, end) => {
    const { actor, start, view } = signInActor();
    start("first");
    view();

    await end(actor);
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": undefined,
        "log": [
          "cancel https://claude.ai/first",
          "ended",
        ],
        "state": ""idle"",
      }
    `);
  });

  it("ends without replacing when the process fails before a code is pasted", async () => {
    const { start, view } = signInActor();
    const { fail } = start("first");
    view();

    fail(new Error("exited"));
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": undefined,
        "log": [
          "ended",
        ],
        "state": ""idle"",
      }
    `);
  });

  it("replaces a sign-in a refused code ended, keeping the old link until the new one is in", async () => {
    const { actor, start, view } = signInActor();
    const { fail } = start("first");
    actor.send({ type: "codePasted" });
    view();

    fail(new Error("code refused"));
    await Promise.resolve();
    expect(actor.getSnapshot().matches("replacing")).toBe(true);
    expect(view().link).toBe("https://claude.ai/first");

    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": "https://claude.ai/restarted",
        "log": [],
        "state": "{"waiting":"open"}",
      }
    `);
  });

  it("ends when the replacement will not start", async () => {
    const { actor, failRestart, start, view } = signInActor();
    failRestart();
    const { fail } = start("first");
    actor.send({ type: "codePasted" });
    view();

    fail(new Error("code refused"));
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": undefined,
        "log": [
          "ended",
        ],
        "state": ""idle"",
      }
    `);
  });

  it("cancels the waiting process when another starts, and restarts the wait", async () => {
    const { start, view } = signInActor();
    start("first");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    view();

    start("second");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(view()).toMatchInlineSnapshot(`
      {
        "link": "https://claude.ai/second",
        "log": [
          "cancel https://claude.ai/first",
        ],
        "state": "{"waiting":"open"}",
      }
    `);
  });
});
