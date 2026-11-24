import { describe, expect, it } from "vitest";

import {
  addPick,
  pickLogSchema,
  rememberedPick,
  type PickLog,
} from "./remembered-picks";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

describe("rememberedPick", () => {
  const log: PickLog = [
    { at: NOW - 40 * DAY, picked: "stale", typed: "old" },
    { at: NOW - 5 * DAY, picked: "wireframes-folder", typed: "wire" },
    { at: NOW - 4 * DAY, picked: "wiki", typed: "wi" },
    { at: NOW - 3 * DAY, picked: "tab-groups", typed: "tab gr" },
    { at: NOW - 2 * DAY, picked: "web", typed: "w" },
    { at: NOW - 1 * DAY, picked: "résumé", typed: "resume" },
  ];

  it.each([
    ["exactly what was typed", "wire", "wireframes-folder"],
    ["the exact words over a newer pick for their start", "wi", "wiki"],
    ["the newest pick these letters go on from", "wiref", "web"],
    ["letters with other case and accents", "  Résumé ", "résumé"],
    ["words however they were spaced", "TAB   gr", "tab-groups"],
    ["nothing for letters never picked for", "zebra", undefined],
    ["nothing for a shorter text than any pick", "ta", undefined],
    ["nothing past 30 days", "old", undefined],
    ["nothing for nothing typed", "", undefined],
  ])("answers %s", (_, typed, expected) => {
    expect(rememberedPick(log, typed, NOW)).toBe(expected);
  });

  it("keeps a pick through its thirtieth day", () => {
    const edge: PickLog = [{ at: NOW - 30 * DAY, picked: "kept", typed: "k" }];
    expect(rememberedPick(edge, "k", NOW)).toBe("kept");
    expect(rememberedPick(edge, "k", NOW + 1)).toBeUndefined();
  });
});

describe("addPick", () => {
  it("adds a pick with its typed text folded", () => {
    expect(addPick([], { at: NOW, picked: "a", typed: " Tab  GR " })).toEqual([
      { at: NOW, picked: "a", typed: "tab gr" },
    ]);
  });

  it("keeps one pick per typed text, the new one", () => {
    const log = addPick(
      [
        { at: NOW - DAY, picked: "a", typed: "wire" },
        { at: NOW - DAY, picked: "b", typed: "tab" },
      ],
      { at: NOW, picked: "c", typed: "Wire" },
    );
    expect(log).toEqual([
      { at: NOW - DAY, picked: "b", typed: "tab" },
      { at: NOW, picked: "c", typed: "wire" },
    ]);
  });

  it("drops picks past 30 days and leaves the log it was given alone", () => {
    const before: PickLog = [{ at: NOW - 31 * DAY, picked: "a", typed: "old" }];
    const after = addPick(before, { at: NOW, picked: "b", typed: "new" });
    expect(after).toEqual([{ at: NOW, picked: "b", typed: "new" }]);
    expect(before).toHaveLength(1);
  });

  it("ignores a pick with nothing typed", () => {
    const log: PickLog = [{ at: NOW, picked: "a", typed: "a" }];
    expect(addPick(log, { at: NOW, picked: "b", typed: "  " })).toBe(log);
  });

  it("keeps the newest 500", () => {
    let log: PickLog = [];
    for (let index = 0; index < 520; index++) {
      log = addPick(log, { at: NOW + index, picked: "p", typed: `t${index}` });
    }
    expect(log).toHaveLength(500);
    expect(log[0]?.typed).toBe("t20");
    expect(log.at(-1)?.typed).toBe("t519");
    expect(pickLogSchema.parse(log)).toEqual(log);
  });
});
