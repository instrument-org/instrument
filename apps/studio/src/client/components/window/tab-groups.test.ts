import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { listedReplacing, listedWith, listedWithout } from "./tab-groups";

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
