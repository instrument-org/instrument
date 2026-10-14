import { ChatIdSchema, StoreId } from "@instrument-org/workspace/electron";
import { describe, expect, it } from "vitest";

import {
  settlesChat,
  shouldShowAgentCompletionNotification,
} from "./agent-completion-notifications";

const cases: {
  expected: boolean;
  input: Parameters<typeof shouldShowAgentCompletionNotification>[0];
}[] = [
  {
    expected: true,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: true,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "always",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "never",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: false,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isSupported: false,
      mode: "unfocused",
    },
  },
];

describe("shouldShowAgentCompletionNotification", () => {
  it.each(cases)("returns $expected for $input", ({ expected, input }) => {
    expect(shouldShowAgentCompletionNotification(input)).toBe(expected);
  });
});

describe("settlesChat", () => {
  const own = StoreId.newSessionId();
  const chat = (over: { state: string; working: boolean }) => ({
    id: ChatIdSchema.parse("2026-10-13-groceries"),
    sessionId: own,
    ...over,
  });

  // A card can be open while a task still works: the chat says it waits,
  // and its reply is still a step on the way.
  it.each([
    ["at rest", chat({ state: "idle", working: false }), own, true],
    [
      "waiting with nothing moving",
      chat({ state: "waiting", working: false }),
      own,
      true,
    ],
    [
      "waiting while a task works",
      chat({ state: "waiting", working: true }),
      own,
      false,
    ],
    ["working", chat({ state: "working", working: true }), own, false],
    [
      "a task's turn ending",
      chat({ state: "idle", working: false }),
      StoreId.newSessionId(),
      false,
    ],
    ["a chat that could not be read", undefined, own, true],
  ] as const)("%s", (_name, read, sessionId, expected) => {
    expect(settlesChat(read, sessionId)).toBe(expected);
  });
});
