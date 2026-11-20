import { describe, expect, it } from "vitest";

import { LayoutChangeSchema, LayoutSnapshotSchema } from "./group-layout";

const TAB = {
  address: "https://example.com",
  id: "tab_1",
  kind: "website",
  title: "Example",
} as const;

describe("a layout record a later build writes", () => {
  it("reads a group of three sides with the keyboard on the third", () => {
    const sides = [{ tabs: [TAB] }, { tabs: [TAB] }, { tabs: [TAB] }];
    expect(
      LayoutSnapshotSchema.safeParse({ focused: 2, group: { id: "g" }, sides })
        .success,
    ).toBe(true);
  });

  it("reads a side named other than left or right", () => {
    expect(
      LayoutChangeSchema.parse({ change: "opened", side: "top", tab: TAB }),
    ).toMatchObject({ side: "top" });
  });
});
