import { describe, expect, it } from "vitest";

import { needsNamedIn, withoutNeedsFences } from "./parse-needs-block";

const RECEIPT = [
  "I found both hotels but cannot book without a choice.",
  "",
  "```needs",
  "- folder: Desktop, to save the confirmation there",
  "app: Linear",
  "",
  "answer: which of the two Lisbon hotels?",
  "app: Linear",
  "```",
].join("\n");

describe("needsNamedIn", () => {
  it("reads one need per line, markers and repeats dropped", () => {
    expect(needsNamedIn(RECEIPT)).toMatchInlineSnapshot(`
      [
        "folder: Desktop, to save the confirmation there",
        "app: Linear",
        "answer: which of the two Lisbon hotels?",
      ]
    `);
  });

  it("finds nothing in a message without the fence", () => {
    expect(needsNamedIn("Done.\n\n```files\nwork/a.md\n```")).toEqual([]);
  });
});

describe("withoutNeedsFences", () => {
  it("keeps the words and drops the fence", () => {
    expect(withoutNeedsFences(RECEIPT)).toMatchInlineSnapshot(
      `"I found both hotels but cannot book without a choice."`,
    );
  });
});
