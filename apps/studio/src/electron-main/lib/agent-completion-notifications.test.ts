import { describe, expect, it } from "vitest";

import { shouldShowAgentCompletionNotification } from "./agent-completion-notifications";

const cases: {
  expected: boolean;
  input: Parameters<typeof shouldShowAgentCompletionNotification>[0];
}[] = [
  {
    expected: true,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: true,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: true,
      isRootSession: true,
      isSupported: true,
      mode: "always",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: true,
      isRootSession: true,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mode: "never",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isRootSession: false,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: false,
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: false,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      appWindowAvailable: true,
      isAppWindowFocused: true,
      isRootSession: false,
      isSupported: true,
      mode: "always",
    },
  },
];

describe("shouldShowAgentCompletionNotification", () => {
  it.each(cases)("returns $expected for $input", ({ expected, input }) => {
    expect(shouldShowAgentCompletionNotification(input)).toBe(expected);
  });
});
