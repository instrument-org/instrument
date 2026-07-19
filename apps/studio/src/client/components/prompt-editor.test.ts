import { describe, expect, it } from "vitest";

import { promptDocFromText, promptTextFromDoc } from "./prompt-editor-model";

describe("prompt editor serialization", () => {
  it("round trips skill tokens and multiline text", () => {
    const value = "Use [$release](skill:release) to ship this.\nKeep notes.";
    expect(promptTextFromDoc(promptDocFromText(value))).toBe(value);
  });

  it("keeps malformed skill links as text", () => {
    const value = "[$label](skill:different)";
    expect(promptTextFromDoc(promptDocFromText(value))).toBe(value);
  });
});
