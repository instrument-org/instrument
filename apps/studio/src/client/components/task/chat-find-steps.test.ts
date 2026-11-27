import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { findReadout, stepFind, unloadedMatches } from "./chat-find-steps";

const older = { count: 2, folded: 0, id: StoreId.newMessageId() };
const old = { count: 1, folded: 0, id: StoreId.newMessageId() };
const drawnTurn = { count: 3, folded: 0, id: StoreId.newMessageId() };
const boxTop = {
  before: 0,
  turn: { count: 2, folded: 0, id: StoreId.newMessageId() },
};
const boxMiddle = {
  before: 2,
  turn: { count: 1, folded: 0, id: StoreId.newMessageId() },
};
const boxEnd = {
  before: 3,
  turn: { count: 4, folded: 0, id: StoreId.newMessageId() },
};

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
    expect(named(stepFind(input))).toBe(expected);
  });

  // Drawn matches 0 to 2, with boxes before 0, between 1 and 2, and after 2.
  const boxed = [boxTop, boxMiddle, boxEnd];
  it.each([
    // Into the box between two drawn matches, from either side.
    [
      { active: 1, forward: true, unloaded: [] },
      `draw ${boxMiddle.turn.id} first`,
    ],
    [
      { active: 2, forward: false, unloaded: [] },
      `draw ${boxMiddle.turn.id} last`,
    ],
    // Past the last drawn match into the box after it.
    [
      { active: 2, forward: true, unloaded: [] },
      `draw ${boxEnd.turn.id} first`,
    ],
    // Up from the first drawn match into the box above it, before any turn not loaded.
    [
      { active: 0, forward: false, unloaded: [old] },
      `draw ${boxTop.turn.id} last`,
    ],
    // Between drawn matches with no box there.
    [{ active: 0, forward: true, unloaded: [] }, "drawn 1"],
  ])("with boxes, %j goes to %s", (input, expected) => {
    expect(named(stepFind({ ...input, boxed, drawn: 3 }))).toBe(expected);
  });

  it.each([
    // Wrapping round from the end: the oldest turn not loaded, else the top box.
    [
      { active: 2, boxed: [boxTop], forward: true, unloaded: [older] },
      `load ${older.id} first`,
    ],
    [
      { active: 2, boxed: [boxTop], forward: true, unloaded: [] },
      `draw ${boxTop.turn.id} first`,
    ],
    // Wrapping round from the top with nothing to load: the box at the end.
    [
      { active: 0, boxed: [boxEnd], forward: false, unloaded: [] },
      `draw ${boxEnd.turn.id} last`,
    ],
    // Nothing drawn: down to the first box, up to the last.
    [
      { active: 0, boxed, drawn: 0, forward: true, unloaded: [] },
      `draw ${boxTop.turn.id} first`,
    ],
    [
      { active: 0, boxed, drawn: 0, forward: false, unloaded: [old] },
      `draw ${boxEnd.turn.id} last`,
    ],
  ])("wrapping, %j goes to %s", (input, expected) => {
    expect(named(stepFind({ drawn: 3, ...input }))).toBe(expected);
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

  it("counts the matches in boxes where they stand among the drawn ones", () => {
    const boxed = [boxTop, boxMiddle, boxEnd];
    // older (2), boxTop (2), drawn 0 and 1, boxMiddle (1), drawn 2, boxEnd (4).
    expect(
      findReadout({ active: 1, boxed, drawn: 3, unloaded: [older] }),
    ).toEqual({ activeMatch: 6, matchCount: 12 });
    expect(
      findReadout({ active: 2, boxed, drawn: 3, unloaded: [older] }),
    ).toEqual({ activeMatch: 8, matchCount: 12 });
  });
});

function named(step: ReturnType<typeof stepFind>): string {
  switch (step.kind) {
    case "drawn": {
      return `drawn ${step.index.toString()}`;
    }
    case "draw":
    case "load": {
      return `${step.kind} ${step.turn.id} ${step.pick}`;
    }
    case "none": {
      return "none";
    }
  }
}
