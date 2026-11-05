import { describe, expect, it } from "vitest";

import { stripPatchHeader } from "./tool-call-utils";

describe("stripPatchHeader", () => {
  // The preamble the patch library writes, spelled out: it belongs to the
  // workspace package and is not a dependency here, so this is a copy of its
  // output rather than a call to it.
  const realPatch = [
    "Index: src/utils/helpers.ts",
    "===================================================================",
    "--- src/utils/helpers.ts",
    "+++ src/utils/helpers.ts",
    "@@ -1,1 +1,1 @@",
    '-str.replace(/[_-]+/g, "-")',
    '+str.replace(/[^a-z0-9]+/g, "-")',
  ].join("\n");

  it("keeps the hunks and drops the preamble", () => {
    expect(stripPatchHeader(realPatch)).toMatchInlineSnapshot(`
      "-str.replace(/[_-]+/g, "-")
      +str.replace(/[^a-z0-9]+/g, "-")"
    `);
  });

  // What a fixed line count did instead: a patch with fewer lines than the
  // preamble came out empty, and an empty body drew no card at all.
  it("never empties a patch that has content", () => {
    expect(stripPatchHeader("@@ -1,1 +1,1 @@\n-old\n+new")).toBe("-old\n+new");
  });

  // Not a patch this understands. Showing it whole beats showing nothing, and
  // silently dropping its first five lines is worse than either.
  it("hands back anything with no hunk header untouched", () => {
    expect(stripPatchHeader("- old\n+ new")).toBe("- old\n+ new");
  });

  // A real edit spans several hunks. Only the first header is a boundary; the
  // ones after it are content and have to survive.
  it("keeps the hunk headers after the first", () => {
    const twoHunks = [
      "--- a",
      "+++ b",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      "@@ -9,2 +9,2 @@",
      "-two",
      "+TWO",
    ].join("\n");

    expect(stripPatchHeader(twoHunks)).toContain("@@ -9,2 +9,2 @@");
  });
});
