import { describe, expect, it } from "vitest";

import { numberedName, safeName } from "./folder-name";

describe("a title as a folder name", () => {
  it("keeps the words, the spaces and the capitals", () => {
    expect(safeName("Quiet dishwashers for a small kitchen")).toBe(
      "Quiet dishwashers for a small kitchen",
    );
  });

  it.each([
    ["a slash", "Before/after", "Before after"],
    ["a backslash", "C:\\Users", "C Users"],
    ["a colon", "Plan: the next week", "Plan the next week"],
    ["a star", "What *really* happened", "What really happened"],
    ["a question mark", "Which one?", "Which one"],
    ["a quote", 'He said "no"', "He said no"],
    ["angle brackets", "<draft>", "draft"],
    ["a pipe", "a | b", "a b"],
    [
      "a dollar sign, which the shell would expand",
      "Quiet dishwashers under $900",
      "Quiet dishwashers under 900",
    ],
    ["a tab", "one\ttwo", "one two"],
    ["a newline", "one\ntwo", "one two"],
    ["a control character", "one\u0001two", "one two"],
  ])("takes out %s", (_what, title, expected) => {
    expect(safeName(title)).toBe(expected);
  });

  it("takes leading dots off, so the folder is not hidden", () => {
    expect(safeName(".hidden plans")).toBe("hidden plans");
  });

  it.each([
    ["a period", "Done.", "Done"],
    ["several periods", "Wait...", "Wait"],
    ["a space", "Trailing ", "Trailing"],
  ])(
    "takes %s off the end, which a system would drop anyway",
    (_what, title, expected) => {
      expect(safeName(title)).toBe(expected);
    },
  );

  it.each(["CON", "nul", "AUX", "com1", "LPT9", "NUL.txt"])(
    "makes %s a name a folder may have",
    (reserved) => {
      expect(safeName(reserved)).toBe(`${reserved}_`);
    },
  );

  it("leaves a title that only starts like a device name alone", () => {
    expect(safeName("Console logs")).toBe("Console logs");
  });

  it("cuts a long title at a word, under the cap", () => {
    const name = safeName(
      "A very long title about dishwashers that runs on and on past what a folder name may hold",
    );
    expect(name).toBe(
      "A very long title about dishwashers that runs on and on past what a folder name",
    );
    expect(name.length).toBeLessThanOrEqual(80);
  });

  it("cuts a single long word at the cap", () => {
    expect(safeName("x".repeat(200))).toBe("x".repeat(80));
  });

  it("keeps a title the person can read, whatever it is written in", () => {
    expect(safeName("🎉 Birthday plans")).toBe("🎉 Birthday plans");
    expect(safeName("夕食の献立")).toBe("夕食の献立");
  });

  it("names a chat whose title says nothing a folder can carry", () => {
    expect(safeName(undefined)).toBe("Untitled chat");
    expect(safeName("")).toBe("Untitled chat");
    expect(safeName("///")).toBe("Untitled chat");
    expect(safeName("...")).toBe("Untitled chat");
  });

  it("composes the name, so it compares equal to a decomposed listing", () => {
    expect(safeName("Cafe\u0301 notes")).toBe("Café notes");
  });
});

describe("a name another folder already holds", () => {
  it("numbers it the way the Finder numbers a copy", () => {
    expect(numberedName("Dishwashers", 2)).toBe("Dishwashers 2");
    expect(numberedName("Dishwashers", 11)).toBe("Dishwashers 11");
  });

  it("keeps a numbered name under the cap", () => {
    const name = numberedName("y".repeat(80), 2);
    expect(name).toBe(`${"y".repeat(78)} 2`);
    expect(name.length).toBe(80);
  });

  it("does not leave a space or a period before the number", () => {
    expect(numberedName(`${"y".repeat(77)}. `, 2)).toBe(`${"y".repeat(77)} 2`);
  });
});
