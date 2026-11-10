import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { findReadout, stepFind, unloadedMatches } from "./chat-find-steps";

const older = { count: 2, folded: 0, id: StoreId.newMessageId() };
const old = { count: 1, folded: 0, id: StoreId.newMessageId() };
const drawnTurn = { count: 3, folded: 0, id: StoreId.newMessageId() };

describe("unloadedMatches", () => {
  it("keeps the turns the transcript does not hold", () => {
    expect(
      unloadedMatches([older, old, drawnTurn], new Set([drawnTurn.id])),
    ).toEqual([older, old]);
    expect(unloadedMatches(undefined, new Set())).toEqual([]);
  });
});

describe("stepFind", () => {
  it.each([
    // Among the drawn matches.
    [{ active: 0, drawn: 3, forward: true, unloaded: [] }, "drawn 1"],
    [{ active: 2, drawn: 3, forward: false, unloaded: [older] }, "drawn 1"],
    // Wrapping round with nothing left to load.
    [{ active: 2, drawn: 3, forward: true, unloaded: [] }, "drawn 0"],
    [{ active: 0, drawn: 3, forward: false, unloaded: [] }, "drawn 2"],
    // Up past the first drawn match loads the nearest turn above.
    [
      { active: 0, drawn: 3, forward: false, unloaded: [older, old] },
      `load ${old.id} before`,
    ],
    // On from the last wraps round to the oldest match of all.
    [
      { active: 2, drawn: 3, forward: true, unloaded: [older, old] },
      `load ${older.id} first`,
    ],
    // Nothing drawn yet.
    [
      { active: 0, drawn: 0, forward: true, unloaded: [older, old] },
      `load ${older.id} first`,
    ],
    [
      { active: 0, drawn: 0, forward: false, unloaded: [older, old] },
      `load ${old.id} last`,
    ],
    [{ active: 0, drawn: 0, forward: true, unloaded: [] }, "none"],
  ])("%j goes to %s", (input, expected) => {
    const step = stepFind(input);
    expect(
      step.kind === "drawn"
        ? `drawn ${step.index.toString()}`
        : step.kind === "load"
          ? `load ${step.turn.id} ${step.pick}`
          : "none",
    ).toBe(expected);
  });
});

describe("findReadout", () => {
  it("counts the matches not loaded above the drawn ones", () => {
    expect(
      findReadout({ active: 1, drawn: 3, unloaded: [older, old] }),
    ).toEqual({ activeMatch: 5, matchCount: 6 });
    expect(findReadout({ active: 0, drawn: 0, unloaded: [older] })).toEqual({
      activeMatch: 0,
      matchCount: 2,
    });
  });
});
