import { describe, expect, it } from "vitest";

import {
  extendSelected,
  keepShown,
  NOTHING_SELECTED,
  normalizeSelection,
  type Selection,
  selectedPathsOf,
  selectExactly,
  selectOnly,
  selectWithMode,
  type SelectionMode,
  toggleSelected,
} from "./file-system-selection";

const ORDER = ["a", "b", "c", "d", "e"];

/** A run of presses from nothing selected: a bare name, `⌘name` or `⇧name`. */
function pressAll(presses: string[]): Selection {
  return presses.reduce<Selection>((selection, press) => {
    const mode: null | SelectionMode = press.startsWith("⌘")
      ? "toggle"
      : press.startsWith("⇧")
        ? "extend"
        : null;
    const path = mode ? press.slice(1) : press;
    return selectWithMode(selection, path, mode, ORDER);
  }, NOTHING_SELECTED);
}

describe("selecting, the way the Finder does", () => {
  it.each([
    { presses: ["a"], selected: ["a"], lead: "a" },
    { presses: ["a", "c"], selected: ["c"], lead: "c" },
    { presses: ["a", "⌘c", "⌘e"], selected: ["a", "c", "e"], lead: "e" },
    // Letting one go hands the keyboard to the last picked before it.
    { presses: ["a", "⌘c", "⌘e", "⌘e"], selected: ["a", "c"], lead: "c" },
    { presses: ["a", "⌘c", "⌘e", "⌘c"], selected: ["a", "e"], lead: "e" },
    { presses: ["a", "⌘a"], selected: [], lead: null },
    { presses: ["b", "⇧d"], selected: ["b", "c", "d"], lead: "d" },
    // A second reach from the same anchor replaces the first.
    { presses: ["b", "⇧d", "⇧a"], selected: ["b", "a"], lead: "a" },
    // ⌘ picks survive a reach that does not cover them.
    { presses: ["a", "⌘c", "⇧e"], selected: ["a", "c", "d", "e"], lead: "e" },
    // A reach from nothing is a plain selection.
    { presses: ["⇧c"], selected: ["c"], lead: "c" },
    // A reach to where it started is that one alone.
    { presses: ["b", "⇧d", "⇧b"], selected: ["b"], lead: "b" },
    { presses: ["a", "⇧c", "b"], selected: ["b"], lead: "b" },
  ])("$presses selects $selected", ({ lead, presses, selected }) => {
    const selection = pressAll(presses);
    expect(selectedPathsOf(selection)).toEqual(selected);
    expect(selection.lead).toBe(lead);
  });

  it("reaches from an anchor that is not in the view's order as a plain selection", () => {
    const selection = extendSelected(selectOnly("z"), "c", ORDER);
    expect(selection).toEqual(selectOnly("c"));
  });

  it("takes exactly what ⌘A asks for, keeping the keyboard where it is", () => {
    expect(selectExactly(selectOnly("c"), ORDER)).toMatchInlineSnapshot(`
      {
        "lead": "c",
        "several": {
          "anchor": "a",
          "paths": [
            "a",
            "b",
            "c",
            "d",
            "e",
          ],
          "range": [
            "a",
            "b",
            "c",
            "d",
            "e",
          ],
        },
      }
    `);
    expect(selectExactly(selectOnly("z"), ["b"])).toEqual(selectOnly("b"));
    expect(selectExactly(selectOnly("z"), [])).toEqual(NOTHING_SELECTED);
  });

  it("drops several that no longer hold the keyboard's one", () => {
    // A caller moved the keyboard onto something it just made.
    const stale: Selection = {
      lead: "new",
      several: { anchor: "a", paths: ["a", "b"], range: ["a", "b"] },
    };
    expect(normalizeSelection(stale)).toEqual(selectOnly("new"));
    expect(selectedPathsOf(stale)).toEqual(["new"]);
    // And a ⌘-click from there starts from that one.
    expect(selectedPathsOf(toggleSelected(stale, "c"))).toEqual(["new", "c"]);
  });

  it("keeps only what a search leaves on screen", () => {
    const selection = pressAll(["a", "⌘c", "⌘e"]);
    expect(keepShown(selection, () => true)).toBe(selection);
    const kept = keepShown(selection, (path) => path === "c");
    expect(selectedPathsOf(kept)).toEqual(["c"]);
    expect(kept.lead).toBe("c");
    expect(keepShown(selection, () => false)).toEqual(NOTHING_SELECTED);
  });
});
