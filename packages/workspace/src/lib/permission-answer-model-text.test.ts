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
});
