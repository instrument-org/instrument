// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { parseStudioDrivePath } from "./studio-drive";

describe("parseStudioDrivePath", () => {
  it("keeps numeric-looking query values as strings", () => {
    expect(
      parseStudioDrivePath("/debug/components/chat-stream?session=3"),
    ).toEqual({
      search: { session: "3" },
      to: "/debug/components/chat-stream",
    });
  });

  it("leaves paths without query parameters alone", () => {
    expect(parseStudioDrivePath("/release-notes")).toEqual({
      to: "/release-notes",
    });
  });
});
