import { describe, expect, it } from "vitest";

import { shouldShowAgentCompletionNotification } from "./agent-completion-notifications";

const cases: {
  expected: boolean;
  input: Parameters<typeof shouldShowAgentCompletionNotification>[0];
}[] = [
  {
    expected: true,
    input: {
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "unfocused",
    },
  },
  {
    expected: true,
    input: {
      isAppWindowFocused: true,
      isRootSession: true,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "always",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: true,
      isRootSession: true,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "never",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: false,
      isRootSession: false,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: true,
      mainWindowAvailable: false,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: false,
      isRootSession: true,
      isSupported: false,
      mainWindowAvailable: true,
      mode: "unfocused",
    },
  },
  {
    expected: false,
    input: {
      isAppWindowFocused: true,
      isRootSession: false,
      isSupported: true,
      mainWindowAvailable: true,
      mode: "always",
    },
  },
];

describe("shouldShowAgentCompletionNotification", () => {
  it.each(cases)("returns $expected for $input", ({ expected, input }) => {
    expect(shouldShowAgentCompletionNotification(input)).toBe(expected);
  });
});
