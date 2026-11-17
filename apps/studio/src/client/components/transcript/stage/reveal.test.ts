import { describe, expect, it } from "vitest";

import {
  MIN_CHARS_PER_SECOND,
  type RevealState,
  advance,
  revealCut,
} from "./reveal";

/** What the reader would see at that cut. */
const shown = (text: string, upTo: number, isStreaming = false) =>
  text.slice(0, revealCut(text, upTo, isStreaming));

describe("revealCut", () => {
  it.each([
    ["Hello there friend", 8, "Hello"],
    ["Hello there friend", 11, "Hello there"],
    ["Hello there friend", 12, "Hello there"],
    ["Hello there friend", 3, ""],
  ])("cuts %j at %i to whole words", (text, upTo, expected) => {
    expect(shown(text, upTo)).toBe(expected);
  });

  it("shows a finished text whole", () => {
    expect(shown("Hello there", 99)).toBe("Hello there");
  });

  it("holds a streaming text's last word until it is whole", () => {
    expect(shown("Hello the", 99, true)).toBe("Hello");
  });

  const TABLE = [
    "Points to note:",
    "",
    "| Plan | Price |",
    "| --- | --- |",
    "| Pro | $20 |",
    "| Max | $100 |",
    "",
    "After.",
  ].join("\n");

  it("holds a table back until its header and divider are both there", () => {
    const inDivider = TABLE.indexOf("---") + 2;
    expect(shown(TABLE, inDivider)).toBe("Points to note:\n\n");
  });

  it("shows a table's rows whole", () => {
    const inRow = TABLE.indexOf("$100");
    expect(shown(TABLE, inRow)).toBe(
      "Points to note:\n\n| Plan | Price |\n| --- | --- |\n| Pro | $20 |\n",
    );
  });

  it("holds a streaming table's unfinished last row", () => {
    const partial = TABLE.slice(0, TABLE.indexOf("$100") + 2);
    expect(
      shown(partial, partial.length, true).endsWith("| Pro | $20 |\n"),
    ).toBe(true);
  });

  it("reveals the paragraph after a table a word at a time", () => {
    const after = TABLE.indexOf("After.");
    expect(shown(TABLE, after + 3)).toBe(TABLE.slice(0, after - 1));
    expect(shown(TABLE, TABLE.length)).toBe(TABLE);
  });
});

/** Ticks a reveal at 60 fps for `ms`, against a text of `length`. */
function run(
  state: RevealState,
  length: number,
  ms: number,
  isStreaming = true,
): RevealState {
  let next = state;
  for (let at = 0; at < ms; at += 16) {
    next = advance(next, length, 16, isStreaming);
  }
  return next;
}

describe("advance", () => {
  it("never goes past the text", () => {
    expect(run({ shown: 0, velocity: 0 }, 50, 2000).shown).toBe(50);
  });

  it("keeps up with a fast stream within about its lag", () => {
    // 2,000 characters arriving at once: most of them are out in half a second.
    const state = run({ shown: 0, velocity: 0 }, 2000, 500);
    expect(state.shown).toBeGreaterThan(1500);
  });

  it("moves at least at the slowest pace while anything is left", () => {
    const state = run({ shown: 0, velocity: 0 }, 1000, 1000);
    expect(state.shown).toBeGreaterThan(MIN_CHARS_PER_SECOND * 0.8);
  });

  it("eases into a new pace rather than jumping to it", () => {
    const first = advance({ shown: 0, velocity: 0 }, 2000, 16, true);
    const settled = run({ shown: 0, velocity: 0 }, 100_000, 1000);
    expect(first.velocity).toBeLessThan(settled.velocity / 4);
  });

  it("finishes quickly once the stream has ended", () => {
    const state = run({ shown: 0, velocity: 400 }, 600, 700, false);
    expect(state.shown).toBe(600);
  });
});
