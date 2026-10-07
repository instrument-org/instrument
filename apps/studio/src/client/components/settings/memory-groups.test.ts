import { type Memory } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { groupMemories, memoryMatches, toggleGroup } from "./memory-groups";

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 9, 7, 12).getTime();

const memory = (
  name: string,
  at: number,
  from?: Memory["from"],
  text = name,
): Memory => ({ at, from, name, path: `/m/${name}.md`, text });

const IMPORT = { sessionId: "s1", title: "Import from ChatGPT" };
const LISBON = { sessionId: "s2", title: "Lisbon trip" };

describe("groupMemories", () => {
  it("joins neighbors from one chat on one day, and nothing else", () => {
    const groups = groupMemories([
      memory("a", NOON, IMPORT),
      memory("b", NOON - 60_000, IMPORT),
      memory("c", NOON - 120_000, LISBON),
      memory("d", NOON - 180_000, IMPORT),
      memory("e", NOON - DAY, IMPORT),
      memory("f", NOON - DAY - 1),
      memory("g", NOON - DAY - 2),
    ]);
    expect(
      groups.map((group) => ({
        from: group.from?.title,
        names: group.memories.map((m) => m.name).join(""),
        newest: group.newest === group.memories[0]?.at,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "from": "Import from ChatGPT",
          "names": "ab",
          "newest": true,
        },
        {
          "from": "Lisbon trip",
          "names": "c",
          "newest": true,
        },
        {
          "from": "Import from ChatGPT",
          "names": "d",
          "newest": true,
        },
        {
          "from": "Import from ChatGPT",
          "names": "e",
          "newest": true,
        },
        {
          "from": undefined,
          "names": "fg",
          "newest": true,
        },
      ]
    `);
  });
});

describe("memoryMatches", () => {
  it.each([
    ["", true],
    ["  ", true],
    ["PACIFIC", true],
    ["mornings", true],
    ["stevia", false],
  ])("%j matches: %s", (query, expected) => {
    expect(
      memoryMatches(
        memory("pacific-time", NOON, undefined, "Mornings are best"),
        query,
      ),
    ).toBe(expected);
  });
});

describe("toggleGroup", () => {
  it("picks the whole group unless all of it was picked", () => {
    const some = toggleGroup(new Set(["a", "x"]), ["a", "b"]);
    expect([...some].toSorted()).toEqual(["a", "b", "x"]);
    expect([...toggleGroup(some, ["a", "b"])]).toEqual(["x"]);
  });
});
