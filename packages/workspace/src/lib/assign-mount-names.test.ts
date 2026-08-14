import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assignMountNames } from "./assign-mount-names";

describe("assignMountNames", () => {
  // The name is the mount path, and the agent quotes mount paths back to the
  // user, so an unnecessary qualifier reaches them as a folder they never named.
  it("keeps the folder's own name when nothing collides", () => {
    const names = assignMountNames([
      { id: "a", path: "/base/project/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
  });

  it("leaves distinct names alone in a set", () => {
    const names = assignMountNames([
      { id: "a", path: "/base/project-a/Downloads" },
      { id: "b", path: "/base/other/Documents" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"Documents"`);
  });

  it("qualifies only the namesake, keeping the first attachment bare", () => {
    const names = assignMountNames([
      { id: "a", path: "/base/project-a/Downloads" },
      { id: "b", path: "/base/project-b/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"project-b-Downloads"`);
  });

  it("walks up further ancestors if the immediate parent also collides", () => {
    const names = assignMountNames([
      { id: "a", path: "/base/x/project/Downloads" },
      { id: "b", path: "/base/y/project/Downloads" },
      { id: "c", path: "/base/z/project/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"project-Downloads"`);
    expect(names.get("c")).toMatchInlineSnapshot(`"z-project-Downloads"`);
  });

  it("falls back to a numeric suffix once ancestors run out", () => {
    const names = assignMountNames([
      { id: "a", path: "/base/nested/project/Downloads" },
      { id: "b", path: "/base/nested/project/Downloads" },
      { id: "c", path: "/base/nested/project/Downloads" },
      { id: "d", path: "/base/nested/project/Downloads" },
      { id: "e", path: "/base/nested/project/Downloads" },
    ]);
    expect([...names.values()]).toMatchInlineSnapshot(`
      [
        "Downloads",
        "project-Downloads",
        "nested-project-Downloads",
        "base-nested-project-Downloads",
        "base-nested-project-Downloads-1",
      ]
    `);
  });

  it("substitutes the home directory's real name with a generic label", () => {
    const home = os.homedir();
    const names = assignMountNames([
      { id: "a", path: "/base/other/Downloads" },
      { id: "b", path: path.join(home, "Downloads") },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"Home-Downloads"`);
  });

  it("falls back to the bare basename when there's no ancestor to qualify with", () => {
    const names = assignMountNames([{ id: "a", path: "/Downloads" }]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
  });
});
