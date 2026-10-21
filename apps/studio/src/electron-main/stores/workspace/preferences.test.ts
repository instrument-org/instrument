import { describe, expect, it } from "vitest";

import { WorkspacePreferencesSchema } from "./preferences";

describe("the feature flags in a workspace's preferences", () => {
  it.each([
    ["a file from a build with fewer flags", { context_ring: true }],
    [
      "a flag this build does not know",
      { context_ring: true, retired_flag: true },
    ],
    [
      "a flag that is not a switch",
      { context_ring: true, suggestions_from_your_chats: "yes" },
    ],
  ])("keeps what it can read from %s", (_, features) => {
    expect(WorkspacePreferencesSchema.parse({ features }).features).toEqual({
      context_ring: true,
      suggestions_from_your_chats: false,
    });
  });

  it("starts with every flag off", () => {
    expect(WorkspacePreferencesSchema.parse({}).features).toEqual({
      context_ring: false,
      suggestions_from_your_chats: false,
    });
  });
});
