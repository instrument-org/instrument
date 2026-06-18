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

  it("strips a leading ./ so both conventions compare equal", () => {
    const result = artifactPanelSchema.safeParse({
      filePath: "./src/index.ts",
      type: "file",
    });
    expect(result.success && result.data.filePath).toBe("src/index.ts");
  });

  it("preserves the file modification time used for chat item identity", () => {
    const result = artifactPanelSchema.safeParse({
      filePath: "output/video.mp4",
      modifiedAt: 1_234_567_890,
      type: "file",
    });
    expect(result.success && result.data.modifiedAt).toBe(1_234_567_890);
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
