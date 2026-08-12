import { SHORTCUT_ENTRIES } from "@/shared/shortcuts";
import { describe, expect, it } from "vitest";

import { matchShortcuts } from "./shortcut-search";

// Labels with the matched characters bracketed, so a ranking or highlight
// change reads directly.
const highlighted = (query: string) =>
  matchShortcuts(SHORTCUT_ENTRIES, query).map(({ descriptor, labelRanges }) => {
    if (!labelRanges) {
      return descriptor.label;
    }
    let out = "";
    let cursor = 0;
    for (let i = 0; i < labelRanges.length; i += 2) {
      const start = labelRanges[i] ?? 0;
      const end = labelRanges[i + 1] ?? 0;
      out += `${descriptor.label.slice(cursor, start)}[${descriptor.label.slice(start, end)}]`;
      cursor = end;
    }
    return out + descriptor.label.slice(cursor);
  });

describe("matchShortcuts", () => {
  it("keeps every shortcut, unhighlighted, for an empty query", () => {
    expect(matchShortcuts(SHORTCUT_ENTRIES, "")).toHaveLength(
      SHORTCUT_ENTRIES.length,
    );
    expect(
      matchShortcuts(SHORTCUT_ENTRIES, "").every(
        ({ labelRanges }) => labelRanges === null,
      ),
    ).toBe(true);
  });

  it("highlights what the query matched in the label", () => {
    expect(highlighted("tab")).toMatchInlineSnapshot(`
      [
        "New [Tab]",
        "Close [Tab]",
        "Show Next [Tab]",
        "Switch to [Tab]",
        "Reopen Closed [Tab]",
        "Show Previous [Tab]",
        "Switch to Last [Tab]",
      ]
    `);
  });

  it("matches on the group a shortcut belongs to", () => {
    expect(highlighted("developer")).toMatchInlineSnapshot(`
      [
        "Reload App",
        "Set Theme: Dark",
        "Set Theme: Light",
        "Set Theme: System",
      ]
    `);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(highlighted("qqq")).toMatchInlineSnapshot(`[]`);
  });
});
