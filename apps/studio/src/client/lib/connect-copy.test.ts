import {
  type ConnectOutcome,
  type ConnectProvider,
} from "@/shared/connect-outcome";
import { describe, expect, it } from "vitest";

import {
  connectLine,
  connectNote,
  connectPageCopy,
  connectToast,
} from "./connect-copy";

const now = new Date(2026, 9, 21, 12, 0);
const resetsAt = new Date(2026, 9, 21, 15, 40).toISOString();

const OUTCOMES: ConnectOutcome[] = [
  { kind: "canceled" },
  { kind: "declined" },
  { kind: "failed", message: "socket hang up" },
  { kind: "no-plan" },
  { kind: "out-of-usage", resetsAt },
  { kind: "out-of-usage" },
  { kind: "ready" },
  { kind: "sign-up-refused" },
  { kind: "signed-out" },
  { kind: "timed-out" },
];

function table(provider: ConnectProvider) {
  return Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome.kind + ("resetsAt" in outcome ? " with reset" : ""),
      connectPageCopy(outcome, provider, { modelName: "GPT-6", now }),
    ]),
  );
}

describe("connectPageCopy", () => {
  it("says no paid plan for ChatGPT", () => {
    expect(connectPageCopy({ kind: "no-plan" }, "chatgpt")).toEqual({
      subtitle:
        "Instrument only works with paid ChatGPT plans. Upgrade and try again, or choose another way to use AI.",
      title: "Your ChatGPT account doesn't have a paid plan",
    });
  });

  it("says when Claude's usage comes back", () => {
    expect(
      connectPageCopy({ kind: "out-of-usage", resetsAt }, "claude", { now }),
    ).toEqual({
      subtitle:
        "Your Claude plan hit its limit, and Claude says it resets around 3:40 PM. You can keep going and use it then, or choose another way to use AI now.",
      title: "Claude is out of usage for now",
    });
  });

  it("never names network trouble, and says nothing for a cancel", () => {
    for (const provider of [
      "chatgpt",
      "claude",
      "grok",
      "instrument",
    ] as const) {
      const pages = Object.values(table(provider)).filter(Boolean);
      expect(
        pages.some((page) =>
          /offline|network|connection/i.test(JSON.stringify(page)),
        ),
      ).toBe(false);
      expect(table(provider).canceled).toBeUndefined();
    }
  });

  it("reads every Grok answer", () => {
    expect(table("grok")).toMatchInlineSnapshot(`
      {
        "canceled": undefined,
        "declined": {
          "subtitle": "Try again, or choose another way to use AI.",
          "title": "You didn't finish signing in to Grok",
        },
        "failed": {
          "subtitle": "Something went wrong. Try again, or choose another way to use AI.",
          "title": "Couldn't sign in to Grok",
        },
        "no-plan": {
          "subtitle": "Your plan needs to include Grok API access. If you pay through X, link your X account at accounts.x.ai. Upgrade and try again, or choose another way to use AI.",
          "title": "Your Grok account doesn't have a paid plan",
        },
        "out-of-usage": {
          "subtitle": "Your Grok plan hit its limit for now. You can keep going and use it once it resets, or choose another way to use AI now.",
          "title": "Grok is out of usage for now",
        },
        "out-of-usage with reset": {
          "subtitle": "Your Grok plan hit its limit, and Grok says it resets around 3:40 PM. You can keep going and use it then, or choose another way to use AI now.",
          "title": "Grok is out of usage for now",
        },
        "ready": {
          "subtitle": "New chats use GPT-6 from your plan.",
          "title": "Grok is ready to use",
        },
        "sign-up-refused": {
          "subtitle": "You can still use Instrument today with a plan you already pay for, or with your own API key.",
          "title": "Instrument isn't open to new accounts yet",
        },
        "signed-out": {
          "subtitle": "Sign in to Grok again to use your plan here.",
          "title": "You're signed out of Grok",
        },
        "timed-out": {
          "subtitle": "Instrument couldn't check your Grok plan. Try again, or choose another way to use AI.",
          "title": "Grok didn't answer in time",
        },
      }
    `);
  });
});

describe("connectNote", () => {
  it("says what a stopped turn's plan needs", () => {
    const cases = [
      ["grok", { kind: "no-plan" }],
      ["chatgpt", { kind: "no-plan" }],
      ["claude", { kind: "no-plan" }],
      ["claude", { kind: "out-of-usage", resetsAt }],
      ["grok", { kind: "out-of-usage" }],
      ["chatgpt", { kind: "signed-out" }],
      ["chatgpt", { kind: "failed", message: "x" }],
    ] satisfies ["chatgpt" | "claude" | "grok", ConnectOutcome][];
    expect(
      cases.map(([provider, outcome]) =>
        connectNote(outcome, provider, { now }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "Your Grok account doesn't have a paid plan.",
        "Your ChatGPT account doesn't have a paid plan.",
        "Your Claude account doesn't have a paid plan.",
        "Claude is out of usage until 3:40 PM.",
        "Grok is out of usage for now.",
        "You're signed out of ChatGPT.",
        undefined,
      ]
    `);
  });
});

describe("connectLine and connectToast", () => {
  it("say nothing for a cancel or a ready line", () => {
    expect(connectLine({ kind: "canceled" }, "claude")).toBeUndefined();
    expect(connectLine({ kind: "ready" }, "claude")).toBeUndefined();
    expect(connectToast({ kind: "canceled" }, "claude")).toBeUndefined();
  });

  it("names the model a sign-in made the default", () => {
    expect(
      connectToast({ kind: "ready" }, "chatgpt", { modelName: "GPT-6" }),
    ).toEqual({
      description: "New chats use GPT-6 from your plan.",
      isError: false,
      title: "Connected your ChatGPT account",
    });
  });

  it("tells a ChatGPT sign-in that left plan access out how to fix it", () => {
    expect(connectToast({ kind: "declined" }, "chatgpt")?.description).toBe(
      "Continue with ChatGPT again and allow Instrument to use your plan.",
    );
    expect(connectToast({ kind: "declined" }, "grok")).toBeUndefined();
  });
});
