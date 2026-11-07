import { describe, expect, it } from "vitest";

import {
  notificationText,
  shouldShowAgentCompletionNotification,
} from "./agent-completion-notifications";

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

describe("notificationText", () => {
  it.each([
    [
      "a message fence by its body",
      "Here it is.\n\n```message\n---\nmessage: chat\nto: Team\nvia: Slack\n---\nI also **worked** on it.\n```",
      "Here it is. I also worked on it.",
    ],
    [
      "past a files fence",
      "Done.\n\n```files\n/Users/mac-user/report.html\n```",
      "Done.",
    ],
  ])("reads %s", (_label, reply, expected) => {
    expect(notificationText(reply)).toBe(expected);
  });
});
