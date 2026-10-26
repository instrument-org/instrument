import { type Os } from "@/shared/os-conventions";
import { describe, expect, it } from "vitest";

import { editorKeys } from "./keys";
import { uiHtml } from "./ui-html";

const OSES: Os[] = ["mac", "windows", "linux"];

/** Every key hint the dock draws, as `<what>: <keys>`, from its markup. */
const dockHints = (os: Os) =>
  [
    ...uiHtml(editorKeys(os)).matchAll(
      /title="([^"]*\(.+?\))"|<kbd>(.+?)<\/kbd> (\w+)/g,
    ),
  ].map(([, title, key = "", what = ""]) => title ?? `${what}: ${key}`);

describe("editorKeys", () => {
  it("writes each hint the way the system writes keys", () => {
    expect(Object.fromEntries(OSES.map((os) => [os, editorKeys(os)])))
      .toMatchInlineSnapshot(`
      {
        "linux": {
          "bold": "Ctrl+B",
          "command": "ctrlKey",
          "delete": "Del",
          "done": "Ctrl+E",
          "duplicate": "Ctrl+D",
          "italic": "Ctrl+I",
          "link": "Ctrl+K",
          "moveDown": "Alt+↓",
          "moveUp": "Alt+↑",
          "newLine": "Shift+Enter",
          "redo": "Ctrl+Shift+Z",
          "selectParent": "Ctrl+↑",
          "submit": "Enter",
          "undo": "Ctrl+Z",
        },
        "mac": {
          "bold": "⌘B",
          "command": "metaKey",
          "delete": "⌫",
          "done": "⌘E",
          "duplicate": "⌘D",
          "italic": "⌘I",
          "link": "⌘K",
          "moveDown": "⌥↓",
          "moveUp": "⌥↑",
          "newLine": "⇧↩",
          "redo": "⇧⌘Z",
          "selectParent": "⌘↑",
          "submit": "↩",
          "undo": "⌘Z",
        },
        "windows": {
          "bold": "Ctrl+B",
          "command": "ctrlKey",
          "delete": "Del",
          "done": "Ctrl+E",
          "duplicate": "Ctrl+D",
          "italic": "Ctrl+I",
          "link": "Ctrl+K",
          "moveDown": "Alt+↓",
          "moveUp": "Alt+↑",
          "newLine": "Shift+Enter",
          "redo": "Ctrl+Shift+Z",
          "selectParent": "Ctrl+↑",
          "submit": "Enter",
          "undo": "Ctrl+Z",
        },
      }
    `);
  });

  // One snapshot for every system: inline snapshots and `it.each` share a
  // call site and overwrite each other.
  it("draws the dock's hints in each system's keys", () => {
    expect(Object.fromEntries(OSES.map((os) => [os, dockHints(os)])))
      .toMatchInlineSnapshot(`
      {
        "linux": [
          "add: Enter",
          "Back to the page (Ctrl+E)",
          "Undo (Ctrl+Z)",
          "Redo (Ctrl+Shift+Z)",
        ],
        "mac": [
          "add: ↩",
          "Back to the page (⌘E)",
          "Undo (⌘Z)",
          "Redo (⇧⌘Z)",
        ],
        "windows": [
          "add: Enter",
          "Back to the page (Ctrl+E)",
          "Undo (Ctrl+Z)",
          "Redo (Ctrl+Shift+Z)",
        ],
      }
    `);
  });
});
