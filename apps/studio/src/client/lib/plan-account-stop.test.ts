import { type SessionMessage } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  lastPlanAccountStop,
  planAccountNoteText,
  planAccountStop,
  planAccountStopLine,
} from "./plan-account-stop";

const STOPPED_AT = new Date(2026, 9, 8, 14, 0);
// 3:40 PM the same day, in seconds since the epoch.
const RESET = new Date(2026, 9, 8, 15, 40).getTime() / 1000;

function stoppedTurn({
  body,
  classification = "usage-limit",
  provider,
}: {
  body?: object;
  classification?: string;
  provider: string;
}) {
  return {
    id: "msg_stopped",
    metadata: {
      aiGatewayModel: { name: "Model", params: { provider } },
      createdAt: STOPPED_AT,
      error: {
        classification,
        kind: "api-call",
        message: "Refused",
        name: "AI_APICallError",
        responseBody: body ? JSON.stringify({ error: body }) : undefined,
        statusCode: 429,
        url: "http://localhost",
      },
      sessionId: "s",
    },
    parts: [],
    role: "assistant",
  } as unknown as SessionMessage.WithParts;
}

describe("planAccountStop", () => {
  it.each([
    {
      line: "I had to stop here. Your Claude plan is out of usage until 3:40 PM.",
      name: "Claude out of usage with its reset",
      note: "Claude is out of usage until 3:40 PM.",
      turn: stoppedTurn({
        body: {
          resets_at: RESET,
          type: "claude_account_usage_limit_exceeded",
        },
        provider: "claude-account",
      }),
    },
    {
      line: "I had to stop here. Your ChatGPT plan is out of usage for now.",
      name: "ChatGPT out of usage with no reset",
      note: "ChatGPT is out of usage for now.",
      turn: stoppedTurn({
        body: { code: "subscription_sharing_usage_limit_exceeded" },
        provider: "chatgpt-account",
      }),
    },
    {
      line: "I couldn't start on this. ChatGPT says this account can't be used in other apps without a paid plan.",
      name: "ChatGPT with no paid plan",
      note: "Your ChatGPT account doesn't have a paid plan.",
      turn: stoppedTurn({
        body: { code: "subscription_sharing_user_not_eligible" },
        classification: "auth",
        provider: "chatgpt-account",
      }),
    },
    {
      line: "I couldn't start on this. Grok says this account doesn't have an eligible paid plan.",
      name: "a Grok account with no plan",
      note: "Your Grok account doesn't have a paid plan.",
      turn: stoppedTurn({ classification: "auth", provider: "grok-account" }),
    },
    {
      line: "I had to stop here. Your Grok plan is out of usage for now.",
      name: "Grok out of usage",
      note: "Grok is out of usage for now.",
      turn: stoppedTurn({ provider: "grok-account" }),
    },
    {
      line: "I couldn't start on this. ChatGPT says this account can't be used in other apps without a paid plan.",
      name: "ChatGPT with plan access left out",
      note: "Your ChatGPT account doesn't have a paid plan.",
      turn: stoppedTurn({
        body: { code: "chatpass_v2_scope_not_authorized" },
        classification: "auth",
        provider: "chatgpt-account",
      }),
    },
  ])("says what stopped $name", ({ line, note, turn }) => {
    const stop = planAccountStop(turn as SessionMessage.Assistant);
    if (!stop) {
      throw new Error("expected a stop");
    }
    expect(planAccountStopLine(stop, STOPPED_AT)).toBe(line);
    expect(planAccountNoteText(stop, STOPPED_AT)).toBe(note);
  });

  it.each([
    {
      name: "a usage limit on the person's own key",
      turn: stoppedTurn({ provider: "openai" }),
    },
    {
      name: "a sign-in problem on ChatGPT",
      turn: stoppedTurn({
        body: { code: "token_revoked" },
        classification: "auth",
        provider: "chatgpt-account",
      }),
    },
  ])("leaves $name to the error card", ({ turn }) => {
    expect(planAccountStop(turn as SessionMessage.Assistant)).toBeUndefined();
  });

  it("says the usage is back once the reset has passed", () => {
    const stop = planAccountStop(
      stoppedTurn({
        body: { resets_at: RESET, type: "claude_account_usage_limit_exceeded" },
        provider: "claude-account",
      }) as SessionMessage.Assistant,
    );
    if (!stop) {
      throw new Error("expected a stop");
    }
    expect(
      planAccountNoteText(stop, new Date(2026, 9, 8, 16, 0)),
    ).toMatchInlineSnapshot(`"Your Claude usage limit has reset."`);
  });
});

describe("lastPlanAccountStop", () => {
  const turn = stoppedTurn({ provider: "chatgpt-account" });
  const user = {
    id: "msg_user",
    metadata: {},
    parts: [],
    role: "user",
  } as unknown as SessionMessage.WithParts;

  it.each([
    { expected: true, isAgentRunning: false, messages: [turn] },
    { expected: false, isAgentRunning: true, messages: [turn] },
    { expected: false, isAgentRunning: false, messages: [turn, user] },
  ])(
    "finds the stop: $expected (running: $isAgentRunning, $messages.length messages)",
    ({ expected, isAgentRunning, messages }) => {
      expect(
        lastPlanAccountStop({ isAgentRunning, messages }) !== undefined,
      ).toBe(expected);
    },
  );
});
