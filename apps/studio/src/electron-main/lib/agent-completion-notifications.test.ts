import { describe, expect, it } from "vitest";

import { shouldShowAgentCompletionNotification } from "./agent-completion-notifications";

describe("shouldShowAgentCompletionNotification", () => {
  it.each([
    {
      expected: true,
      input: {
        enabled: true,
        isAppWindowFocused: false,
        isRootSession: true,
        isSupported: true,
        mainWindowAvailable: true,
      },
    },
    {
      expected: false,
      input: {
        enabled: false,
        isAppWindowFocused: false,
        isRootSession: true,
        isSupported: true,
        mainWindowAvailable: true,
      },
    },
    {
      expected: false,
      input: {
        enabled: true,
        isAppWindowFocused: true,
        isRootSession: true,
        isSupported: true,
        mainWindowAvailable: true,
      },
    },
    {
      expected: false,
      input: {
        enabled: true,
        isAppWindowFocused: false,
        isRootSession: false,
        isSupported: true,
        mainWindowAvailable: true,
      },
    },
    {
      expected: false,
      input: {
        enabled: true,
        isAppWindowFocused: false,
        isRootSession: true,
        isSupported: true,
        mainWindowAvailable: false,
      },
    },
    {
      expected: false,
      input: {
        enabled: true,
        isAppWindowFocused: false,
        isRootSession: true,
        isSupported: false,
        mainWindowAvailable: true,
      },
    },
  ])("returns $expected for $input", ({ expected, input }) => {
    expect(shouldShowAgentCompletionNotification(input)).toBe(expected);
  });
});
