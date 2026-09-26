import { EditorState, type Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  changesBetween,
  detectIndent,
  fileText,
  readOnlyReason,
  rebase,
  textForm,
} from "./text-sync";

/** A document as the editor would hold the body, split on the file's own breaks. */
function docOf(body: string, lineBreak: string) {
  return EditorState.create({
    doc: body,
    extensions: EditorState.lineSeparator.of(lineBreak),
  }).doc;
}

const join = (doc: Text, lineBreak: string) =>
  doc.sliceString(0, doc.length, lineBreak);

describe("textForm", () => {
  it.each([
    ["lf", "a\nb\n", "\n", false],
    ["crlf", "a\r\nb\r\n", "\r\n", false],
    ["mixed", "a\r\nb\nc", "\n", false],
    ["bom", "\uFEFFa\r\nb", "\r\n", true],
    ["no trailing newline", "a\nb", "\n", false],
    ["lone cr", "a\rb\n", "\n", false],
  ])("round trips %s byte for byte", (_name, text, lineBreak, bom) => {
    const form = textForm(text);
    expect(form.lineBreak).toBe(lineBreak);
    expect(form.bom).toBe(bom);
    const doc = docOf(form.body, form.lineBreak);
    expect(fileText(form, join(doc, form.lineBreak))).toBe(text);
  });
});

describe("changesBetween", () => {
  it.each([
    ["lf edit", "one\ntwo\nthree\n", "one\n2\nthree\nfour\n", "\n"],
    ["lf to empty", "one\ntwo", "", "\n"],
    ["crlf edit", "one\r\ntwo\r\nthree", "zero\r\none\r\nTWO\r\nthree", "\r\n"],
    ["crlf replace all", "x", "y", "\r\n"],
    ["crlf drop last line", "a\r\nb\r\nc", "a\r\nb", "\r\n"],
    ["crlf add trailing break", "a\r\nb", "a\r\nb\r\n", "\r\n"],
    ["crlf from empty", "", "a\r\nb", "\r\n"],
  ])("turns one text into the other: %s", (_name, from, to, lineBreak) => {
    const doc = docOf(from, lineBreak);
    const changes = changesBetween(from, to, lineBreak as "\n" | "\r\n");
    expect(join(changes.apply(doc), lineBreak)).toBe(to);
  });
});

describe("rebase", () => {
  it("keeps the person's edit and the agent's in different places", () => {
    const base = "alpha\nbeta\ngamma\n";
    const ours = "alpha!\nbeta\ngamma\n";
    const theirs = "alpha\nbeta\ngamma\ndelta\n";
    const baseDoc = docOf(base, "\n");
    const mine = changesBetween(base, ours, "\n");
    const agent = changesBetween(base, theirs, "\n");
    const { overlaps, theirsOnScreen, unsaved } = rebase(agent, mine);
    const onScreen = theirsOnScreen.apply(mine.apply(baseDoc));
    expect(onScreen.toString()).toBe("alpha!\nbeta\ngamma\ndelta\n");
    expect(unsaved.apply(docOf(theirs, "\n")).toString()).toBe(
      onScreen.toString(),
    );
    expect(overlaps).toBe(0);
  });

  it("counts an overlap when both changed the same line", () => {
    const base = "alpha\nbeta\n";
    const mine = changesBetween(base, "alpha\nBETA\n", "\n");
    const agent = changesBetween(base, "alpha\nbeta two\n", "\n");
    expect(rebase(agent, mine).overlaps).toBeGreaterThan(0);
  });
});

describe("readOnlyReason", () => {
  it.each([
    ["plain", "hello\n", false],
    ["nul", "a\0b", true],
    ["replacement", "a\uFFFDb", true],
    ["long line", "x".repeat(30_000), true],
  ])("%s", (_name, text, readOnly) => {
    expect(readOnlyReason(text) !== null).toBe(readOnly);
  });
});

describe("detectIndent", () => {
  it.each([
    ["tabs", "a\n\tb\n\tc\n", "\t"],
    ["two", "a\n  b\n    c\n", "  "],
    ["four", "a\n    b\n        c\n", "    "],
    ["none", "a\nb\n", "  "],
  ])("%s", (_name, text, indent) => {
    expect(detectIndent(text)).toBe(indent);
  });
});
