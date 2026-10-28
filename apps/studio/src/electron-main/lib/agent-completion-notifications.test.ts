import { describe, expect, it } from "vitest";

import { shouldShowAgentCompletionNotification } from "./agent-completion-notifications";

const cases: {
  expected: boolean;
  input: Parameters<typeof shouldShowAgentCompletionNotification>[0];
}[] = [
  {
    expected: true,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: true,
    input: {
      canRevealChat: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "always",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "never",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: false,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
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
