import { describe, expect, it } from "vitest";

import { permissionAnswerModelNote } from "./permission-answer-model-text";

describe("permissionAnswerModelNote", () => {
  it.each([
    [
      { answer: "allowed", kind: "folder", target: "/Users/mac-user/Desktop" },
      "The person allowed the folder /Users/mac-user/Desktop in this chat.",
    ],
    [
      { answer: "allowed", kind: "app", target: "Reminders", through: "macos" },
      "macOS now lets Instrument into Reminders.",
    ],
    [
      {
        answer: "allowed",
        kind: "folder",
        target: "C:/Users/windows-user/Documents",
        through: "windows-protection",
      },
      "The person let Instrument through Windows ransomware protection for the folder C:/Users/windows-user/Documents.",
    ],
  ] as const)("tells who let the app in: %o", (data, said) => {
    expect(permissionAnswerModelNote(data)).toContain(said);
  });

  // A "Not now" must read as a decision to work around, never as leave to
  // try another way in, whatever the card was for.
  it.each([
    [
      { answer: "declined", kind: "folder", target: "/Users/mac-user/Pantry" },
      "The person said not now to the folder /Users/mac-user/Pantry. Carry on without it",
    ],
    [
      { answer: "declined", kind: "app", target: "Mail", through: "macos" },
      "The person said not now to Mail. Carry on without it",
    ],
    [
      { answer: "always", kind: "app", target: "Mail" },
      "The person allowed Mail for every chat.",
    ],
  ] as const)("tells what the person said: %o", (data, said) => {
    expect(permissionAnswerModelNote(data)).toContain(said);
  });

  it.each([
    [
      "kept",
      {
        answer: "declined",
        kind: "tab",
        page: { title: "", url: "https://example.com/inbox" },
        target: "t3",
      },
      'The user kept tab t3 ("https://example.com/inbox") for themselves. Open https://example.com/inbox in a tab of your own',
    ],
    [
      "closed",
      { answer: "gone", kind: "tab", target: "t3" },
      "Tab t3 closed before the user answered.",
    ],
    [
      "handed over",
      { answer: "allowed", kind: "tab", target: "t3" },
      "The user moved tab t3 into this chat",
    ],
  ] as const)("tells what became of a tab the person %s", (_, data, said) => {
    expect(permissionAnswerModelNote(data)).toContain(said);
  });
});
