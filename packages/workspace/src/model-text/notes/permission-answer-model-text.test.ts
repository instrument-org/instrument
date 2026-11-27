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
});

describe("permissionAnswerModelNote for a command run as administrator", () => {
  const command = "systemsetup -settimezone America/New_York";
  it.each([
    [
      {
        answer: "allowed",
        kind: "admin",
        run: { exitCode: 0, is: "ran", output: "set time zone" },
        target: command,
      },
      "Ran as administrator. Exit code 0.\nset time zone",
    ],
    [
      {
        answer: "allowed",
        kind: "admin",
        run: { exitCode: 3, is: "ran", output: "" },
        target: command,
      },
      "Ran as administrator. Exit code 3.",
    ],
    [
      { answer: "declined", kind: "admin", target: command },
      "The user didn't allow this command, and nothing ran. Don't run it another way: give them a Markdown link that opens its page of the system's settings, as your system information shows, and say what to change there.",
    ],
    [
      {
        answer: "declined",
        kind: "admin",
        run: { is: "canceled" },
        target: command,
      },
      "The user didn't allow this command, and nothing ran.",
    ],
    [
      {
        answer: "allowed",
        kind: "admin",
        run: { is: "failed", message: "Not an administrator" },
        target: command,
      },
      "couldn't run it as an administrator: Not an administrator",
    ],
    [
      {
        answer: "allowed",
        kind: "admin",
        run: { is: "unknown" },
        target: command,
      },
      "whether it ran is unknown",
    ],
    [
      { answer: "without-admin", kind: "admin", target: command },
      "The user chose not to run this as an administrator, and nothing ran. Find a way to do it without one. If there is none, say so in a line and link its page of the system's settings.",
    ],
    [
      { answer: "ran-by-hand", kind: "admin", target: command },
      "The user says they ran this command themselves, outside Instrument. Check that it took effect without running it again, then go on.",
    ],
  ] as const)("tells how it went: %o", (data, said) => {
    expect(permissionAnswerModelNote(data)).toContain(said);
  });
});
