import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assignFolderNames } from "./assign-folder-names";

describe("assignFolderNames", () => {
  it("qualifies with the parent dir name even with no collision", () => {
    const names = assignFolderNames([
      { id: "a", path: "/base/project/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"project-Downloads"`);
  });

  it("qualifies every folder in the set, not just colliding ones", () => {
    const names = assignFolderNames([
      { id: "a", path: "/base/project-a/Downloads" },
      { id: "b", path: "/base/project-b/Downloads" },
      { id: "c", path: "/base/other/Documents" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"project-a-Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"project-b-Downloads"`);
    expect(names.get("c")).toMatchInlineSnapshot(`"other-Documents"`);
  });

  it("walks up further ancestors if the immediate parent also collides", () => {
    const names = assignFolderNames([
      { id: "a", path: "/base/x/project/Downloads" },
      { id: "b", path: "/base/y/project/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"project-Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"y-project-Downloads"`);
  });

  it("falls back to a numeric suffix once ancestors run out", () => {
    const names = assignFolderNames([
      { id: "a", path: "/base/nested/project/Downloads" },
      { id: "b", path: "/base/nested/project/Downloads" },
      { id: "c", path: "/base/nested/project/Downloads" },
      { id: "d", path: "/base/nested/project/Downloads" },
    ]);
    expect([...names.values()]).toMatchInlineSnapshot(`
      [
        "project-Downloads",
        "nested-project-Downloads",
        "base-nested-project-Downloads",
        "base-nested-project-Downloads-1",
      ]
    `);
  });

  it("substitutes the home directory's real name with a generic label", () => {
    const home = os.homedir();
    const names = assignFolderNames([
      { id: "a", path: path.join(home, "Downloads") },
      { id: "b", path: "/base/other/Downloads" },
    ]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Home-Downloads"`);
    expect(names.get("b")).toMatchInlineSnapshot(`"other-Downloads"`);
  });

  it("falls back to the bare basename when there's no ancestor to qualify with", () => {
    const names = assignFolderNames([{ id: "a", path: "/Downloads" }]);
    expect(names.get("a")).toMatchInlineSnapshot(`"Downloads"`);
  });
});
