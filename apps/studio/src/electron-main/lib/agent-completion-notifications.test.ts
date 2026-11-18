import { describe, expect, it } from "vitest";

import {
  finalReplyText,
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
      systemStatus: "allowed",
    },
  },
  {
    expected: true,
    input: {
      canRevealChat: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "always",
      systemStatus: "allowed",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: true,
      isSupported: true,
      mode: "unfocused",
      systemStatus: "allowed",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "never",
      systemStatus: "allowed",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: false,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
      systemStatus: "allowed",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: false,
      mode: "unfocused",
      systemStatus: "allowed",
    },
  },
  {
    expected: false,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "always",
      systemStatus: "not-asked",
    },
  },
  {
    expected: true,
    input: {
      canRevealChat: true,
      isAppWindowFocused: false,
      isSupported: true,
      mode: "unfocused",
      systemStatus: "unsupported",
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

describe("finalReplyText", () => {
  it.each([
    [
      "the answer, past the preamble before the work",
      [
        "I'll compare the newest raw and clean transcripts.",
        "Yes, that was a transcription error.",
      ],
      "Yes, that was a transcription error.",
    ],
    [
      "the last words when the last step only shows files",
      ["Here's the report.", "```files\n/Users/mac-user/report.html\n```"],
      "Here's the report.",
    ],
    ["nothing when the turn only acted", [], undefined],
  ])("reads %s", (_label, texts, expected) => {
    expect(finalReplyText(texts)).toBe(expected);
  });
});
