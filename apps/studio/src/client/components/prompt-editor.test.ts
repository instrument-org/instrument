import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  deleteSkillBackward,
  promptDocFromText,
  promptSchema,
  promptTextFromDoc,
} from "./prompt-editor-model";

function stateWithCaretAtEnd(value: string) {
  const doc = promptDocFromText(value);
  return EditorState.create({
    doc,
    schema: promptSchema,
    selection: TextSelection.atEnd(doc),
  });
}

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

describe("deleteSkillBackward", () => {
  it("removes a whole token in one press", () => {
    const state = stateWithCaretAtEnd("Ship [$release](skill:release)");
    let next: EditorState | undefined;
    const handled = deleteSkillBackward(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    expect(next && promptTextFromDoc(next.doc)).toBe("Ship ");
  });

  it("defers to the default handler when the caret follows text", () => {
    const state = stateWithCaretAtEnd("Ship it");
    expect(deleteSkillBackward(state)).toBe(false);
  });

  it("defers to the default handler at the start of the line", () => {
    const state = stateWithCaretAtEnd("");
    expect(deleteSkillBackward(state)).toBe(false);
  });
});
