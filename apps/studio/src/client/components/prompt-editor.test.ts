import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  deleteTokenBackward,
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

describe("deleteTokenBackward", () => {
  it("removes a whole token in one press", () => {
    const state = stateWithCaretAtEnd("Ship [$release](skill:release)");
    let next: EditorState | undefined;
    const handled = deleteTokenBackward(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    expect(next && promptTextFromDoc(next.doc)).toBe("Ship ");
  });

  it("defers to the default handler when the caret follows text", () => {
    const state = stateWithCaretAtEnd("Ship it");
    expect(deleteTokenBackward(state)).toBe(false);
  });

  it("defers to the default handler at the start of the line", () => {
    const state = stateWithCaretAtEnd("");
    expect(deleteTokenBackward(state)).toBe(false);
  });
});

describe("app mentions", () => {
  it("round trips an app named as the link a reply writes", () => {
    const value = "Check [Gmail](instrument://app/gmail) for the invoice.";
    const doc = promptDocFromText(value);
    expect(doc.firstChild?.childCount).toBe(3);
    expect(promptTextFromDoc(doc)).toBe(value);
  });

  it("keeps a link to something that is not an app as text", () => {
    const value = "See [that thread](instrument://thread/ses_01JC).";
    const doc = promptDocFromText(value);
    expect(doc.firstChild?.childCount).toBe(1);
    expect(promptTextFromDoc(doc)).toBe(value);
  });

  it("removes a whole app token in one press", () => {
    const state = stateWithCaretAtEnd("Check [Gmail](instrument://app/gmail)");
    let next: EditorState | undefined;
    const handled = deleteTokenBackward(state, (tr) => {
      next = state.apply(tr);
    });
    expect(handled).toBe(true);
    expect(next && promptTextFromDoc(next.doc)).toBe("Check ");
  });
});
