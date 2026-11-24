import { addPick, rememberedPick } from "@/shared/remembered-picks";
import { describe, expect, it } from "vitest";

import { WorkspaceStateSchema } from "./state";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the picks a search remembers in a workspace's state", () => {
  it("are read back from the file as they were written", () => {
    const searchPicks = addPick([], {
      at: DAY_MS,
      picked: "folder:/Users/mac-user/wireframes",
      typed: "Wire",
    });
    const written = JSON.stringify(WorkspaceStateSchema.parse({ searchPicks }));

    const read = WorkspaceStateSchema.parse(JSON.parse(written));

    expect(rememberedPick(read.searchPicks, "wire", 2 * DAY_MS)).toBe(
      "folder:/Users/mac-user/wireframes",
    );
  });

  it.each([
    ["a file from a build that kept none", {}],
    ["picks this build cannot read", { searchPicks: [{ typed: 1 }] }],
  ])("start empty from %s, with the rest of the file kept", (_, file) => {
    expect(
      WorkspaceStateSchema.parse({ ...file, modelRoutes: { a: "b" } }),
    ).toMatchObject({ modelRoutes: { a: "b" }, searchPicks: [] });
  });
});
