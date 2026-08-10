import { describe, expect, it } from "vitest";

import { matchComposerActions } from "./composer-action-search";

const actions = [
  { label: "Add files" },
  { label: "Work in a local folder" },
  { label: "Work in a project" },
];

// The label with the matched runs wrapped, which is what the menu renders.
const marked = (label: string, ranges: null | number[]) => {
  if (!ranges) {
    return label;
  }
  let marked = "";
  let cursor = 0;
  for (let index = 0; index < ranges.length; index += 2) {
    const start = ranges[index] ?? 0;
    const end = ranges[index + 1] ?? 0;
    marked += `${label.slice(cursor, start)}[${label.slice(start, end)}]`;
    cursor = end;
  }
  return marked + label.slice(cursor);
};

describe("matchComposerActions", () => {
  it("keeps every action and highlights nothing for an empty query", () => {
    expect(matchComposerActions(actions, "")).toEqual(
      actions.map((action) => ({ action, labelRanges: null })),
    );
  });

  it("returns nothing when the query matches no label", () => {
    expect(matchComposerActions(actions, "zzz")).toEqual([]);
  });

  it.each([
    ["files", ["Add [files]"]],
    ["work", ["[Work] in a local folder", "[Work] in a project"]],
    ["proj", ["Work in a [proj]ect"]],
  ])("marks what %s matched", (query, expected) => {
    expect(
      matchComposerActions(actions, query).map((match) =>
        marked(match.action.label, match.labelRanges),
      ),
    ).toEqual(expected);
  });

  it("keeps the given order rather than ranking the matches", () => {
    const reversed = [...actions].reverse();
    expect(
      matchComposerActions(reversed, "work").map((match) => match.action.label),
    ).toEqual(["Work in a project", "Work in a local folder"]);
  });
});
