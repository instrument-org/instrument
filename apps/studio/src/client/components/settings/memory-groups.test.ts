import { ChatIdSchema, type Memory } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import { groupMemories, memoryMatches, toggleGroup } from "./memory-groups";

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date(2026, 9, 7, 12).getTime();

const memory = (
  name: string,
  at: number,
  chat?: Memory["chat"],
  text = name,
): Memory => ({ at, chat, name, path: `/m/${name}.md`, text });

const IMPORT = ChatIdSchema.parse("import");
const LISBON = ChatIdSchema.parse("lisbon");

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
        chat: group.chat,
        names: group.memories.map((m) => m.name).join(""),
        newest: group.newest === group.memories[0]?.at,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "chat": "import",
          "names": "ab",
          "newest": true,
        },
        {
          "chat": "lisbon",
          "names": "c",
          "newest": true,
        },
        {
          "chat": "import",
          "names": "d",
          "newest": true,
        },
        {
          "chat": "import",
          "names": "e",
          "newest": true,
        },
        {
          "chat": undefined,
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
