import { describe, expect, it } from "vitest";

import {
  appendDictatedText,
  appendDictatedTextWithin,
  formatDictationClock,
} from "./dictation-text";

describe("appendDictatedText", () => {
  it.each([
    [
      "an empty box takes the words as they are",
      "",
      "Hello there.",
      "Hello there.",
    ],
    ["a box of only spaces takes them too", "   ", "Hello.", "Hello."],
    [
      "written text gets them on a new line",
      "Draft this",
      "Then send it.",
      "Draft this\nThen send it.",
    ],
    [
      "trailing spaces give way to the new line",
      "Draft this  ",
      "Then send it.",
      "Draft this\nThen send it.",
    ],
    [
      "a fresh line is written on",
      "Draft this\n",
      "Then send it.",
      "Draft this\nThen send it.",
    ],
    ["the dictated words are trimmed", "Draft", "  hi  ", "Draft\nhi"],
    ["nothing dictated leaves the box alone", "Draft  ", "   ", "Draft  "],
  ])("%s", (_case, existing, dictated, expected) => {
    expect(appendDictatedText(existing, dictated)).toBe(expected);
  });
});

describe("formatDictationClock", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [9_500, "0:09"],
    [61_000, "1:01"],
    [600_000, "10:00"],
  ])("shows %i ms as %s", (ms, clock) => {
    expect(formatDictationClock(ms)).toBe(clock);
  });
});

describe("appendDictatedTextWithin", () => {
  it.each([
    [
      "words that fit go in whole",
      "Note",
      "short words",
      40,
      "Note\nshort words",
      false,
    ],
    [
      "the end is left out at a word boundary",
      "Note",
      "one two three",
      13,
      "Note\none two",
      true,
    ],
    [
      "a cut that lands between words keeps the last whole one",
      "Note",
      "one two three",
      12,
      "Note\none two",
      true,
    ],
    ["a full box is left as it was", "Full", "more", 4, "Full", true],
    [
      "one long word is cut where it has to be",
      "",
      "abcdefgh",
      5,
      "abcde",
      true,
    ],
  ])("%s", (_case, existing, dictated, max, text, trimmed) => {
    expect(appendDictatedTextWithin(existing, dictated, max)).toEqual({
      text,
      trimmed,
    });
  });
});
