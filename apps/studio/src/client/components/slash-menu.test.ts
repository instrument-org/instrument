import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { promptDocFromText, promptSchema } from "./prompt-editor-model";
import {
  closeSlashMenu,
  hoverSlashMenu,
  moveSlashMenu,
  slashMenuOf,
  slashMenuPlugin,
} from "./slash-menu";

function stateWithCaretAtEnd(value: string) {
  const doc = promptDocFromText(value);
  return EditorState.create({
    doc,
    plugins: [slashMenuPlugin()],
    schema: promptSchema,
    selection: TextSelection.atEnd(doc),
  });
}

const typed = (state: EditorState, text: string) =>
  state.apply(state.tr.insertText(text));

describe("slash menu", () => {
  it("starts closed, even on a draft that ends in a slash", () => {
    expect(slashMenuOf(stateWithCaretAtEnd("Try /pd")).menu).toBeNull();
  });

  it.each([
    ["/", { from: 1, query: "", to: 2 }],
    ["Use /pd", { from: 5, query: "pd", to: 8 }],
    ["Use /claude:pdf", { from: 5, query: "claude:pdf", to: 16 }],
    ["a/b", null],
    ["Use /pd now", null],
  ])("reads %j as %j", (text, menu) => {
    expect(slashMenuOf(typed(stateWithCaretAtEnd(""), text)).menu).toEqual(
      menu,
    );
  });

  it("closes on a selection that is not a caret", () => {
    const open = typed(stateWithCaretAtEnd(""), "/pd");
    const selected = open.apply(
      open.tr.setSelection(TextSelection.create(open.doc, 1, 4)),
    );
    expect(slashMenuOf(selected).menu).toBeNull();
  });

  it("moves the mark with the arrows, wrapping, and scrolls to it", () => {
    let state = typed(stateWithCaretAtEnd(""), "/");
    const marks = [];
    for (const direction of [1, 1, 1, -1, -1] as const) {
      state = state.apply(moveSlashMenu(state, direction, 3));
      marks.push(slashMenuOf(state).index);
    }
    expect(marks).toEqual([1, 2, 0, 2, 1]);
    expect(slashMenuOf(state).scroll).toBe(true);
  });

  it("marks a hovered row without scrolling to it", () => {
    const open = typed(stateWithCaretAtEnd(""), "/");
    const hovered = open.apply(hoverSlashMenu(open, 2));
    expect(slashMenuOf(hovered)).toMatchObject({ index: 2, scroll: false });
  });

  it("goes back to the first row when the query changes", () => {
    let state = typed(stateWithCaretAtEnd(""), "/");
    state = state.apply(moveSlashMenu(state, 1, 3));
    state = typed(state, "p");
    expect(slashMenuOf(state)).toMatchObject({ index: 0, scroll: true });
  });

  it("closes on request and stays closed for a move", () => {
    let state = typed(stateWithCaretAtEnd(""), "/");
    state = state.apply(closeSlashMenu(state));
    expect(slashMenuOf(state).menu).toBeNull();
    state = state.apply(moveSlashMenu(state, 1, 3));
    expect(slashMenuOf(state)).toMatchObject({ index: 0, menu: null });
  });
});
