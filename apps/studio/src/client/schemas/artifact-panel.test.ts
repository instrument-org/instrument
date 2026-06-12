import { describe, expect, it } from "vitest";

import { artifactPanelSchema } from "./artifact-panel";

describe("artifactPanelSchema", () => {
  it("accepts a plain relative file path", () => {
    const result = artifactPanelSchema.safeParse({
      filePath: "src/index.ts",
      type: "file",
    });
    expect(result.success).toBe(true);
  });

  it.each([
    { filePath: "../../../../.ssh/id_rsa", label: "parent traversal" },
    { filePath: "src/../../secret.txt", label: "nested traversal" },
    { filePath: "src\\..\\..\\secret.txt", label: "backslash traversal" },
  ])("rejects $label", ({ filePath }) => {
    const result = artifactPanelSchema.safeParse({ filePath, type: "file" });
    expect(result.success).toBe(false);
  });
});
