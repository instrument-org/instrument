import { formatAcceleratorFor } from "@/client/lib/format-accelerator";
import {
  SHORTCUT_GUIDE_ENTRIES,
  SHORTCUT_GUIDE_GROUPS,
} from "@/shared/shortcut-guide";
import { describe, expect, it } from "vitest";

import { matchShortcuts } from "./shortcut-search";

// Labels with the matched characters bracketed, so a ranking or highlight
// change reads directly.
const highlighted = (query: string) =>
  matchShortcuts(SHORTCUT_GUIDE_ENTRIES, query).map(
    ({ entry: { label }, labelRanges }) => {
      if (!labelRanges) {
        return label;
      }
      let out = "";
      let cursor = 0;
      for (let i = 0; i < labelRanges.length; i += 2) {
        const start = labelRanges[i] ?? 0;
        const end = labelRanges[i + 1] ?? 0;
        out += `${label.slice(cursor, start)}[${label.slice(start, end)}]`;
        cursor = end;
      }
      return out + label.slice(cursor);
    },
  );

describe("SHORTCUT_GUIDE_ENTRIES", () => {
  it("lists every chord the app window answers to, by group", () => {
    const lines = SHORTCUT_GUIDE_GROUPS.flatMap((group) =>
      SHORTCUT_GUIDE_ENTRIES.filter((entry) => entry.group === group)
        .toSorted((a, b) => a.label.localeCompare(b.label))
        .map(
          ({ accelerator, label }) =>
            `${group}: ${label}  ${formatAcceleratorFor({ accelerator, isMac: true }).join("")}`,
        ),
    );
    expect(lines).toMatchInlineSnapshot(`
      [
        "General: Close Window  ⇧⌘W",
        "General: Command Menu  ⌘K",
        "General: Keyboard Shortcuts  ?",
        "General: New Chat  ⌘N",
        "General: Search or Ask  ⌘L",
        "General: Settings...  ⌘,",
        "Chats: Next Chat  ⌥⌘↓",
        "Chats: Paste as Text  ⇧⌘V",
        "Chats: Previous Chat  ⌥⌘↑",
        "Chats: Toggle Inbox  ⌘B",
        "Tabs: Close Tab  ⌘W",
        "Tabs: Last Tab  ⌘9",
        "Tabs: New Tab  ⌘T",
        "Tabs: Reopen Closed Tab  ⇧⌘T",
        "Tabs: Show Next Tab  ⌃Tab",
        "Tabs: Show Previous Tab  ⌃⇧Tab",
        "Tabs: Tab 1 to 8  ⌘1…8",
        "Pages: Back  ⌘[",
        "Pages: Edit Page  ⌘E",
        "Pages: Find in Page  ⌘F",
        "Pages: Forward  ⌘]",
        "Pages: Reload Page  ⌘R",
        "View: Actual Size  ⌘0",
        "View: Toggle Full Screen  ⌃⌘F",
        "View: Zoom In  ⌘+",
        "View: Zoom Out  ⌘-",
        "Developer: Reload App  ⇧⌘R",
        "Developer: Set Theme: Dark  ⇧⌘D",
        "Developer: Set Theme: Light  ⇧⌘L",
        "Developer: Set Theme: System  ⇧⌘M",
      ]
    `);
  });

  it("gives every entry an id of its own", () => {
    const ids = SHORTCUT_GUIDE_ENTRIES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("matchShortcuts", () => {
  it("keeps every shortcut, unhighlighted, for an empty query", () => {
    const matches = matchShortcuts(SHORTCUT_GUIDE_ENTRIES, "");
    expect(matches).toHaveLength(SHORTCUT_GUIDE_ENTRIES.length);
    expect(matches.every(({ labelRanges }) => labelRanges === null)).toBe(true);
  });

  it("highlights what the query matched in the label", () => {
    expect(highlighted("tab")).toMatchInlineSnapshot(`
      [
        "[Tab] 1 to 8",
        "New [Tab]",
        "Last [Tab]",
        "Close [Tab]",
        "Show Next [Tab]",
        "Reopen Closed [Tab]",
        "Show Previous [Tab]",
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
