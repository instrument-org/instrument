import { describe, expect, it } from "vitest";

import { loadQuestions, outOfDate, toReread } from "./ui-truth.ts";

const QUESTION = {
  answer: "In the menu.",
  id: 1,
  question: "Where is it?",
  readOff: [
    { file: "menu.tsx", text: "Pin" },
    { file: "menu.tsx", text: "Close" },
  ],
};

describe("the answer key", () => {
  it("asks each question once, and says what each answer was read off", () => {
    const questions = loadQuestions();
    expect(new Set(questions.map(({ id }) => id)).size).toBe(questions.length);
    for (const { answer, question, readOff } of questions) {
      expect(question).not.toBe("");
      expect(answer).not.toBe("");
      expect(readOff.length).toBeGreaterThan(0);
      for (const { file, text } of readOff) {
        expect(file).toMatch(/^(apps|packages)\//);
        expect(text).not.toBe("");
      }
    }
  });

  it("is out of date where the text it was read off is gone", () => {
    expect(outOfDate([QUESTION], () => "Pin Close")).toEqual([]);
    expect(outOfDate([QUESTION], () => "Pin")).toEqual([
      { id: 1, missing: 'menu.tsx has no "Close"' },
    ]);
    expect(outOfDate([QUESTION], () => undefined)[0]?.missing).toBe(
      "menu.tsx is gone",
    );
  });

  it("names a changed file once", () => {
    expect(toReread([QUESTION], new Set(["menu.tsx"]))).toEqual([
      { files: ["menu.tsx"], id: 1 },
    ]);
    expect(toReread([QUESTION], new Set(["other.tsx"]))).toEqual([]);
  });
});
