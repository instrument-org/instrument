import { type DebugStateEntry } from "./types";

/** The states this page draws, each reached at its `?state=`. */
export const questionStates = [
  { id: "one-question", label: "One question" },
  { id: "several-questions", label: "Several questions" },
  { id: "sending", label: "Sending" },
  { id: "picked", label: "Picked a choice" },
  { id: "picked-with-note", label: "Picked a choice, with a note" },
  { id: "own-words", label: "Answered in their own words" },
  { id: "skipped-with-note", label: "Skipped, with a note" },
  { id: "several-answered", label: "Several answered" },
  { id: "ended", label: "Ended without an answer" },
] as const satisfies readonly DebugStateEntry[];
