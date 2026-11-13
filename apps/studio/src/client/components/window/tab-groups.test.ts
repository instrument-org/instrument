import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import {
  isWorthKeeping,
  listedReplacing,
  listedWith,
  listedWithout,
  nameCarried,
  namedWith,
} from "./tab-groups";

describe("a group whose chat has not started, closed", () => {
  const draft = { createdAt: 0, id: "d", updatedAt: 0, words: "" };

  it.each([
    ["is kept with words", { ...draft, words: "Plan the trip" }, []],
    ["is kept with tabs or a name", draft, ["draft:d"]],
    ["goes with nothing in it", draft, []],
    ["goes when only another group is kept", draft, ["draft:e"]],
  ])("%s", (label, entry, kept) => {
    expect(isWorthKeeping(entry, new Set(kept))).toBe(
      label.startsWith("is kept"),
    );
  });
});

describe("a tab group's name", () => {
  const NAMES = { "draft:a": "Wireframes" };

  it.each([
    ["names a group", {}, "draft:a", "Wireframes", NAMES],
    ["trims the name", {}, "draft:a", "  Wireframes ", NAMES],
    [
      "renames a named group",
      NAMES,
      "draft:a",
      "Keepers",
      { "draft:a": "Keepers" },
    ],
    ["takes the name off with a blank one", NAMES, "draft:a", "  ", {}],
    ["leaves another group's name", NAMES, "draft:b", "", NAMES],
  ])("%s", (_, names, group, name, expected) => {
    expect(namedWith(names, group, name)).toEqual(expected);
  });

  it("keeps the names as they were when nothing changes", () => {
    expect(namedWith(NAMES, "draft:a", "Wireframes")).toBe(NAMES);
    expect(namedWith(NAMES, "draft:b", "")).toBe(NAMES);
  });

  it("goes on with a group whose chat starts, and stays the draft's", () => {
    expect(nameCarried(NAMES, "draft:a", "chat")).toEqual({
      chat: "Wireframes",
      "draft:a": "Wireframes",
    });
    expect(nameCarried(NAMES, "draft:b", "chat")).toBe(NAMES);
  });
});

describe("a window's list of tab groups", () => {
  it.each([
    ["at the top", ["a", "b"], "c", ["c", "a", "b"]],
    ["once", ["a", "b"], "a", ["a", "b"]],
    ["in a window that kept none", null, "a", ["a"]],
  ])("takes a group %s", (_, list, group, expected) => {
    expect(listedWith(list, group)).toEqual(expected);
  });

  it.each([
    ["before a group", { before: "c" }, ["a", "x", "c"]],
    ["after a group", { after: "a" }, ["a", "x", "c"]],
    ["after a group when the one before is gone", { after: "c", before: "z" }, ["a", "c", "x"]],
    ["at the top when it names no group listed", { before: "z" }, ["x", "a", "c"]],
  ])("places a group %s", (_, place, expected) => {
    expect(listedWith(["a", "c"], "x", place)).toEqual(expected);
  });

  it("moves a listed group to its new place", () => {
    expect(listedWith(["a", "b", "c"], "c", { before: "a" })).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("lets a group go and keeps the rest in order", () => {
    expect(listedWithout(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it.each([
    [
      "in the draft's place",
      ["a", "draft:d", "b"],
      ["a", "chat", "b"],
    ],
    ["at the top when the draft was not listed", ["a"], ["chat", "a"]],
    [
      "once when the chat was listed already",
      ["chat", "draft:d"],
      ["chat"],
    ],
  ])("has a started chat %s", (_, list, expected) => {
    expect(listedReplacing(list, "draft:d", "chat")).toEqual(expected);
  });
});
