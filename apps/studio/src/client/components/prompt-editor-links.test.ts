import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  linkAtCaret,
  linkSelectionToPasted,
  promptLinksPlugin,
  removeLink,
  setLinkHref,
} from "./prompt-editor-links";
import {
  continueList,
  indentListItem,
  promptListsPlugin,
  removeListMarker,
} from "./prompt-editor-lists";
import {
  promptDocFromText,
  promptSchema,
  promptTextFromDoc,
} from "./prompt-editor-model";

/** A box holding `value`, the caret where `|` stands (at the end without one), or a selection between two `|`. */
function box(value: string) {
  const [before = "", ...rest] = value.split("|");
  const text = before + rest.join("");
  const doc = promptDocFromText(text);
  const posOf = (offset: number) => {
    // Offsets count text characters; each line break crosses a paragraph's close and open.
    const lines = text.slice(0, offset).split("\n");
    return 1 + offset + (lines.length - 1);
  };
  const anchor = value.includes("|") ? posOf(before.length) : undefined;
  const head =
    rest.length > 1 ? posOf(before.length + (rest[0]?.length ?? 0)) : anchor;
  return EditorState.create({
    doc,
    plugins: [promptLinksPlugin(), promptListsPlugin()],
    schema: promptSchema,
    selection:
      anchor === undefined
        ? TextSelection.atEnd(doc)
        : TextSelection.create(doc, anchor, head),
  });
}

function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: EditorState["tr"]) => void) => boolean,
) {
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { handled, text: promptTextFromDoc(next.doc), state: next };
}

describe("links in the prompt", () => {
  it.each([
    "Check [Zendesk's plans](https://www.zendesk.com/pricing) today",
    "Open https://www.zendesk.com/pricing/ and compare",
    "[Gmail](instrument://app/gmail) and [that chat](instrument://chat/ses_01JC)",
  ])("round trips %j", (value) => {
    expect(promptTextFromDoc(promptDocFromText(value))).toBe(value);
  });

  it("reads a Markdown link to a page as linked words", () => {
    const doc = promptDocFromText("See [the plans](https://zendesk.com).");
    const linked = doc.firstChild?.child(1);
    expect(linked?.text).toBe("the plans");
    expect(linked?.marks.map((mark) => mark.attrs.href)).toEqual([
      "https://zendesk.com",
    ]);
  });

  it("finds the address the caret is in, as the sent message would", () => {
    const state = box("Compare https://zendesk.com/pri|cing, then report");
    expect(linkAtCaret(state)).toMatchObject({
      href: "https://zendesk.com/pricing",
      labeled: false,
    });
  });

  it("does not draw an address while it is still being typed", () => {
    let state = box("Compare https://zendesk.co");
    state = state.apply(state.tr.insertText("m"));
    expect(linkAtCaret(state)).toBeUndefined();
    // A space ends it, and moving the caret back into it finds it.
    state = state.apply(state.tr.insertText(" "));
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 12)),
    );
    expect(linkAtCaret(state)?.href).toBe("https://zendesk.com");
  });

  it("draws a pasted address at once", () => {
    let state = box("Compare ");
    state = state.apply(
      state.tr.insertText("https://zendesk.com").setMeta("paste", true),
    );
    expect(linkAtCaret(state)?.href).toBe("https://zendesk.com");
  });

  it("links selected words to a pasted address", () => {
    const state = box("Compare |the plans| today");
    const tr = linkSelectionToPasted(state, " https://zendesk.com/pricing\n");
    expect(tr && promptTextFromDoc(state.apply(tr).doc)).toBe(
      "Compare [the plans](https://zendesk.com/pricing) today",
    );
  });

  it.each([
    ["no selection", "Compare the plans|", "https://zendesk.com"],
    ["words that are not an address", "Compare |the plans|", "pricing page"],
    ["a selection across lines", "one |two\nthree| four", "https://a.com"],
  ])("pastes as usual over %s", (_case, value, text) => {
    expect(linkSelectionToPasted(box(value), text)).toBeNull();
  });

  it("edits and unlinks linked words, keeping them", () => {
    const linked = box("See [the plans](https://a.com/x) now");
    // In the words "the plans", which start after "See ".
    const state = linked.apply(
      linked.tr.setSelection(TextSelection.create(linked.doc, 7)),
    );
    const link = linkAtCaret(state);
    expect(link?.labeled).toBe(true);
    if (!link) {
      return;
    }
    expect(
      promptTextFromDoc(
        state.apply(setLinkHref(state, link, "https://b.com")).doc,
      ),
    ).toBe("See [the plans](https://b.com) now");
    expect(promptTextFromDoc(state.apply(removeLink(state, link)).doc)).toBe(
      "See the plans now",
    );
  });

  it("writes a label it could not read back beside its address", () => {
    const state = box("See |a [b]| now");
    const tr = linkSelectionToPasted(state, "https://a.com");
    expect(tr && promptTextFromDoc(state.apply(tr).doc)).toBe(
      "See a [b] https://a.com now",
    );
  });
});

describe("lists in the prompt", () => {
  it.each([
    ["- milk", "- milk\n- "],
    ["* milk", "* milk\n* "],
    ["  - milk", "  - milk\n  - "],
    ["1. milk", "1. milk\n2. "],
    ["9) milk", "9) milk\n10) "],
  ])("carries %j on to a new line", (value, expected) => {
    const { handled, text } = run(box(value), continueList);
    expect(handled).toBe(true);
    expect(text).toBe(expected);
  });

  it("ends the list on a line left with only its marker", () => {
    const { handled, text } = run(box("- milk\n- "), continueList);
    expect(handled).toBe(true);
    expect(text).toBe("- milk\n");
  });

  it("splits an item mid-line with the next marker", () => {
    const { text } = run(box("1. milk |eggs"), continueList);
    expect(text).toBe("1. milk \n2. eggs");
  });

  it.each(["milk", "-milk", "1.milk", "|- milk"])(
    "leaves Shift-Enter to make a plain line in %j",
    (value) => {
      expect(continueList(box(value))).toBe(false);
    },
  );

  it("takes the marker out on Backspace just past it, keeping the indent", () => {
    const { handled, text } = run(box("  - |milk"), removeListMarker);
    expect(handled).toBe(true);
    expect(text).toBe("  milk");
    expect(removeListMarker(box("- mi|lk"))).toBe(false);
  });

  it("moves an item in and out with Tab", () => {
    expect(run(box("- milk"), indentListItem(1)).text).toBe("  - milk");
    expect(run(box("    - milk"), indentListItem(-1)).text).toBe("  - milk");
    // Off a list item, Tab is left to move focus.
    expect(indentListItem(1)(box("milk"))).toBe(false);
  });

  it.each([
    ["- ", "- ", "- "],
    ["  * ", "* ", "  * "],
    ["2. ", "2. ", "2. "],
    // Not a marker typed twice: a bullet before a number stays as written.
    ["- ", "1. ", "- 1. "],
  ])(
    "takes back a marker typed by habit after %j",
    (carried, typed, expected) => {
      let state = box(carried);
      state = state.apply(state.tr.insertText(typed));
      expect(promptTextFromDoc(state.doc)).toBe(expected);
    },
  );
});
