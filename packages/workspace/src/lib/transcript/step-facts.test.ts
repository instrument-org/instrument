import { describe, expect, it } from "vitest";

import { appCallOf, countedAs, noteReadOnlyTools } from "./step-facts";

const row = (tool: string, calls: number, failed = 0, app = "notion") => ({
  app,
  calls,
  failed,
  ms: 10,
  tool,
});
const files = (count: number, change: "changed" | "read" = "changed") =>
  Array.from({ length: count }, (_, index) => ({
    change,
    path: `/f${index.toString()}`,
    via: change === "read" ? ("command" as const) : ("disk" as const),
  }));

describe("countedAs", () => {
  it("counts what succeeded of the one tool that changes something", () => {
    expect(countedAs("rows added", [row("add-row", 9, 2)], [])).toEqual([
      { count: 7, label: "rows added" },
    ]);
  });

  it("says nothing when more than one tool changes things", () => {
    expect(
      countedAs("rows added", [row("add-row", 9), row("delete-row", 3)], []),
    ).toEqual([]);
  });

  it("counts reads only for a label about reading", () => {
    noteReadOnlyTools("notion", ["search"]);
    expect(countedAs("pages checked", [row("search", 4)], [])).toEqual([
      { count: 4, label: "pages checked" },
    ]);
    expect(countedAs("rows added", [row("search", 4)], [])).toEqual([]);
    expect(countedAs("pages checked", [row("GET", 4, 0, "api")], [])).toEqual([
      { count: 4, label: "pages checked" },
    ]);
  });

  it("counts files with no app call, past a script and its notes", () => {
    expect(countedAs("frames rendered", [], files(12))).toEqual([
      { count: 12, label: "frames rendered" },
    ]);
    expect(countedAs("frames rendered", [], files(3))).toEqual([]);
    expect(countedAs("files read", [], files(12, "read"))).toEqual([]);
  });

  it("draws nothing with no label", () => {
    expect(countedAs(undefined, [row("add-row", 9)], files(12))).toEqual([]);
  });
});

describe("appCallOf", () => {
  it.each([
    [
      "apps.call",
      { app: "notion", tool: "search" },
      { app: "notion", tool: "search" },
    ],
    [
      "apps.request",
      { app: "api", method: "POST" },
      { app: "api", tool: "POST" },
    ],
    ["apps.tools", { app: "notion" }, undefined],
    ["apps.call", { tool: "search" }, undefined],
  ])("reads %s %j", (capability, input, call) => {
    expect(appCallOf(capability, input)).toEqual(call);
  });
});
