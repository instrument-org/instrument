// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { parseStudioDrivePath } from "./studio-drive";

describe("parseStudioDrivePath", () => {
  it("keeps numeric-looking query values as strings", () => {
    expect(
      parseStudioDrivePath("/debug/components/transcript?scenario=3"),
    ).toEqual({
      search: { scenario: "3" },
      to: "/debug/components/transcript",
    });
  });

  it("leaves paths without query parameters alone", () => {
    expect(parseStudioDrivePath("/release-notes")).toEqual({
      to: "/release-notes",
    });
  });
});
