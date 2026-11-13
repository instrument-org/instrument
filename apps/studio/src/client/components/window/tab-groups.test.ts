import { describe, expect, it, vi } from "vitest";

vi.mock("@/client/rpc/client", () => ({ rpcClient: {} }));

import { listedReplacing, listedWith, listedWithout } from "./tab-groups";

describe("a window's list of tab groups", () => {
  it.each([
    ["at the bottom", ["a", "b"], "c", ["a", "b", "c"]],
    ["once", ["a", "b"], "a", ["a", "b"]],
    ["in a window that kept none", null, "a", ["a"]],
  ])("takes a group %s", (_, list, group, expected) => {
    expect(listedWith(list, group)).toEqual(expected);
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
    ["at the bottom when the draft was not listed", ["a"], ["a", "chat"]],
    [
      "once when the chat was listed already",
      ["chat", "draft:d"],
      ["chat"],
    ],
  ])("has a started chat %s", (_, list, expected) => {
    expect(listedReplacing(list, "draft:d", "chat")).toEqual(expected);
  });
});
