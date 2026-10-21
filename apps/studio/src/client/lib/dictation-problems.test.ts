import { describe, expect, it } from "vitest";

import {
  describeDictationProblem,
  type DictationProblem,
  resetPhrase,
} from "./dictation-problems";

// 2:30 PM on a Tuesday in New York.
const now = new Date("2026-10-13T18:30:00.000Z");
const timeZone = "America/New_York";

describe("describeDictationProblem", () => {
  const kinds: DictationProblem["kind"][] = [
    "allowance-reached",
    "allowance-used-up",
    "capture-failed",
    "connection",
    "microphone-busy",
    "microphone-refused",
    "no-microphone",
    "nothing-heard",
    "rate-limited",
    "rejected",
    "server",
    "signed-out",
    "too-large",
    "too-short",
    "unsupported-audio",
  ];

  it("says every problem in a toast, keeping the recording only where a retry is offered", () => {
    const notices = Object.fromEntries(
      kinds.map((kind) => {
        const problem: DictationProblem =
          kind === "allowance-reached" || kind === "allowance-used-up"
            ? { kind, resetsAt: "2026-10-14T00:00:00.000Z" }
            : { kind };
        const notice = describeDictationProblem(problem, {
          canOpenSettings: true,
          now,
          timeZone,
        });
        expect(notice.keepsRecording).toBe(
          notice.action === "retry" || notice.action === "sign-in",
        );
        return [
          kind,
          `${notice.tone}: ${notice.title} / ${notice.description ?? ""}${notice.action ? ` [${notice.action}]` : ""}`,
        ];
      }),
    );
    expect(notices).toMatchInlineSnapshot(`
      {
        "allowance-reached": "info: You've used today's dictation / Your recording is safe, and you can send it at 8:00 PM. [retry]",
        "allowance-used-up": "info: You've used today's dictation / You can dictate again at 8:00 PM.",
        "capture-failed": "error: Couldn't start recording / Something went wrong with the microphone. Try again.",
        "connection": "error: Couldn't reach Instrument / Your recording is safe. Check your connection, then try again. [retry]",
        "microphone-busy": "error: Couldn't start recording / Another app is using the microphone. Close it, then try again.",
        "microphone-refused": "error: Couldn't use the microphone / You can let Instrument use the microphone in System Settings. [open-settings]",
        "no-microphone": "error: Couldn't find a microphone / Plug one in, then try again.",
        "nothing-heard": "info: Didn't quite catch that / There were no words in that recording. Try again.",
        "rate-limited": "error: Couldn't transcribe that yet / Your recording is safe. Wait a moment, then try again. [retry]",
        "rejected": "error: Couldn't transcribe that / Dictation couldn't use that recording. If you picked a language in Settings, try Auto-detect.",
        "server": "error: Couldn't transcribe that / Something went wrong on our side. Your recording is safe, so you can try again. [retry]",
        "signed-out": "error: Couldn't transcribe that / Your recording is safe, and it goes through once you log in to Instrument. [sign-in]",
        "too-large": "error: Couldn't transcribe that / That recording is too long to send. Try a shorter one.",
        "too-short": "info: Didn't quite catch that / Talk for a little longer before you press Stop.",
        "unsupported-audio": "error: Couldn't transcribe that / Dictation couldn't read the audio in that recording. Try recording it again.",
      }
    `);
  });

  it("does not offer System Settings where there is none to open", () => {
    expect(
      describeDictationProblem(
        { kind: "microphone-refused" },
        { canOpenSettings: false },
      ).action,
    ).toBeUndefined();
  });
});

describe("resetPhrase", () => {
  it.each([
    ["later today", "2026-10-14T00:00:00.000Z", "at 8:00 PM"],
    ["tomorrow", "2026-10-14T13:00:00.000Z", "tomorrow at 9:00 AM"],
    ["further out", "2026-10-16T13:00:00.000Z", "on Friday at 9:00 AM"],
    ["no time given", undefined, "tomorrow"],
    ["a time that doesn't parse", "soon", "tomorrow"],
  ])("%s", (_case, resetsAt, phrase) => {
    expect(resetPhrase(resetsAt, { now, timeZone })).toBe(phrase);
  });
});
