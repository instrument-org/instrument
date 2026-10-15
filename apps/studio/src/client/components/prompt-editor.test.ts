import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  appendDictated,
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
    const value = "See [that chat](instrument://chat/ses_01JC).";
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

describe("appendDictated", () => {
  it.each([
    [
      "an empty box takes the words in its only line",
      "",
      "Hello there.",
      "[Hello there.](dictated:)",
    ],
    [
      "written text gets them after a space on its line",
      "Draft this.",
      "Then send it.",
      "Draft this. [Then send it.](dictated:)",
    ],
    [
      "a box ending on a fresh line is written on",
      "Draft this\n",
      "Then send it.",
      "Draft this\n[Then send it.](dictated:)",
    ],
    [
      "several dictated lines stay several",
      "Draft",
      "One\nTwo",
      "Draft [One](dictated:)\n[Two](dictated:)",
    ],
    [
      "a skill already in the box is left as its token",
      "Use [$release](skill:release)",
      "now",
      "Use [$release](skill:release) [now](dictated:)",
    ],
  ])("%s", (_case, existing, dictated, expected) => {
    const state = stateWithCaretAtEnd(existing);
    const next = state.apply(appendDictated(state, dictated));
    expect(promptTextFromDoc(next.doc)).toBe(expected);
  });

  it.each([
    [
      "dictated words between typed ones",
      "Typed [then said](dictated:) and typed",
    ],
    ["a line that is all dictated", "[All said.](dictated:)"],
    ["two dictated runs on a line", "[One](dictated:) and [two](dictated:)"],
  ])("reads and writes %s unchanged", (_case, text) => {
    expect(promptTextFromDoc(promptDocFromText(text))).toBe(text);
  });

  it("leaves words typed after dictated ones unmarked", () => {
    const state = stateWithCaretAtEnd("");
    const said = state.apply(appendDictated(state, "Said"));
    const typed = said.apply(
      said.tr.insertText(" typed", said.doc.content.size - 1),
    );
    expect(promptTextFromDoc(typed.doc)).toBe("[Said](dictated:) typed");
  });

  it("keeps the caret where it was typing", () => {
    const doc = promptDocFromText("Draft this");
    const state = EditorState.create({
      doc,
      schema: promptSchema,
      selection: TextSelection.create(doc, 3),
    });
    const next = state.apply(appendDictated(state, "More."));
    expect(next.selection.from).toBe(3);
  });
});
