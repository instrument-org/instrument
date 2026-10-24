import { describe, expect, it } from "vitest";

import {
  type Candidate,
  countOf,
  defaultPicks,
  pickerRows,
  pickRange,
  toggleAll,
  visibleCandidates,
} from "./chat-import-model";

const NOW = new Date(2026, 9, 24);

function candidate(
  sourceId: string,
  date: Date,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    createdAt: date,
    imported: null,
    kind: "chatgpt-export",
    messages: 4,
    sourceId,
    title: sourceId,
    updatedAt: date,
    ...extra,
  };
}

const LIST = [
  candidate("old", new Date(2025, 2, 3), { project: "Home" }),
  candidate("new", new Date(2026, 9, 20), { preview: "Kitchen budget" }),
  candidate("sub", new Date(2026, 9, 18), { incidental: true }),
  candidate("done", new Date(2026, 8, 2), {
    imported: "chat-1" as Candidate["imported"],
  }),
  candidate("mid", new Date(2026, 9, 1)),
];

describe("defaultPicks", () => {
  it("picks what the person had and is not here yet", () => {
    expect([...defaultPicks(LIST)].toSorted()).toEqual(["mid", "new", "old"]);
  });
});

describe("visibleCandidates", () => {
  it("hides incidental chats and sorts newest first", () => {
    expect(
      visibleCandidates(LIST, { query: "", showIncidental: false }).map(
        (entry) => entry.sourceId,
      ),
    ).toEqual(["new", "mid", "done", "old"]);
  });

  it.each([
    ["kitchen", ["new"]],
    ["home", ["old"]],
    ["sub", ["sub"]],
    ["nothing", []],
  ])("matches %s in title, preview, or project", (query, ids) => {
    expect(
      visibleCandidates(LIST, { query, showIncidental: true }).map(
        (entry) => entry.sourceId,
      ),
    ).toEqual(ids);
  });
});

describe("pickerRows", () => {
  it("puts chats under their month, a month carrying only what can be picked", () => {
    const rows = pickerRows(
      visibleCandidates(LIST, { query: "", showIncidental: false }),
      NOW,
    ).map((row) =>
      row.type === "month"
        ? `# ${row.label} [${row.selectable.join(",")}]`
        : row.candidate.sourceId,
    );
    expect(rows).toEqual([
      "# October [new,mid]",
      "new",
      "mid",
      "# September []",
      "done",
      "# March 2025 [old]",
      "old",
    ]);
  });
});

describe("toggleAll", () => {
  it("adds the missing, or drops all when every one is picked", () => {
    expect([...toggleAll(new Set(["a"]), ["a", "b"])]).toEqual(["a", "b"]);
    expect([...toggleAll(new Set(["a", "b", "c"]), ["a", "b"])]).toEqual(["c"]);
  });
});

describe("pickRange", () => {
  const visible = visibleCandidates(LIST, { query: "", showIncidental: false });

  it("picks the selectable chats between two presses", () => {
    expect([
      ...pickRange(new Set(), visible, { from: "new", to: "old" }),
    ]).toEqual(["new", "mid", "old"]);
  });

  it("unpicks the range when the pressed one was picked", () => {
    expect([
      ...pickRange(new Set(["new", "mid", "old"]), visible, {
        from: "new",
        to: "mid",
      }),
    ]).toEqual(["old"]);
  });
});

describe("countOf", () => {
  it.each([
    [1, "1 chat"],
    [1204, "1,204 chats"],
  ])("says %i", (n, text) => {
    expect(countOf(n, "chat")).toBe(text);
  });
});
