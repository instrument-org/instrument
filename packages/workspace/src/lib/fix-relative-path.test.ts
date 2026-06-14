import { describe, expect, it } from "vitest";

import { fixRelativePath } from "./fix-relative-path";

describe("fixRelativePath", () => {
  it.each([
    { input: "./src/index.ts", label: "normal relative path" },
    { input: "src/index.ts", label: "relative without leading dot" },
    { input: "/src/index.ts", label: "leading-slash path (converted to ./)" },
    { input: "file.txt", label: "bare filename" },
  ])("accepts $label", ({ input }) => {
    expect(fixRelativePath(input)).not.toBeNull();
  });

  it.each([
    { input: "../outside.txt", label: "parent traversal with forward slash" },
    {
      input: "./src/../../../outside.txt",
      label: "nested forward-slash traversal",
    },
  ])("rejects $label", ({ input }) => {
    expect(fixRelativePath(input)).toBeNull();
  });

  // Confirms the known bypass: fixRelativePath only checks for "../" (forward
  // slash). A backslash traversal like "./subdir\..\..\outside.txt" slips
  // through because the check is !path.includes("../") and the path only
  // contains "..\". The security boundary for this case is enforced by
  // resolvePathWithinAppDir (which normalises backslashes before checking
  // containment) — see its own test file and the tool-layer tests.
  it("BYPASS: passes Windows backslash traversal (fixRelativePath gap)", () => {
    const input = "./subdir\\..\\..\\outside.txt";
    // The path contains "..\\" but no "../" → slips through fixRelativePath.
    const result = fixRelativePath(input);
    expect(result).not.toBeNull();
  });
});
