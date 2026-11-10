import { type Dictation } from "@/client/hooks/use-dictation";
import { renderWithProviders } from "@/tests/render";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DictationReadout } from "./dictation-controls";

const dictation = (
  phase: Dictation["phase"],
  live: Dictation["live"],
): Dictation => ({
  cancel: () => undefined,
  live,
  phase,
  start: () => undefined,
  stop: () => undefined,
  stream: undefined,
});

describe("DictationReadout when the live stream is gone", () => {
  // The whole take is transcribed at Stop, so a gone stream loses no words:
  // while recording the line says where the words will come from, and once
  // stopped (a stream closing on the way out, or losing the race with Stop)
  // it shows nothing different from any other transcription.
  it.each([
    [
      "dropped mid-take",
      { kind: "recording" },
      { interim: "", settled: "", status: "lost" },
      "Your words will appear when you stop",
    ],
    [
      "dropped after some words",
      { kind: "recording" },
      { interim: "", settled: "The first part", status: "lost" },
      "The first part The rest will appear when you stop",
    ],
    [
      "never opened",
      { kind: "recording" },
      { interim: "", settled: "", status: "unavailable" },
      "Your words will appear when you stop",
    ],
    [
      "closed after Stop",
      { kind: "transcribing" },
      { interim: "", settled: "", status: "lost" },
      "Transcribing…",
    ],
    [
      "lost the race with Stop",
      { kind: "transcribing" },
      { interim: "", settled: "", status: "unavailable" },
      "Transcribing…",
    ],
  ] satisfies [string, Dictation["phase"], Dictation["live"], string][])(
    "%s",
    (_, phase, live, line) => {
      renderWithProviders(
        <DictationReadout dictation={dictation(phase, live)} />,
      );
      expect(screen.getByRole("status").textContent).toBe(line);
    },
  );
});
