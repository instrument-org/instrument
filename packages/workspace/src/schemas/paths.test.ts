import { describe, expect, it } from "vitest";

import { RelativeTaskPathSchema, WorkspaceFilePathSchema } from "./paths";

describe("RelativeTaskPathSchema", () => {
  it.each(["src/index.ts", "./src/index.ts", "file.txt"])(
    "accepts %s",
    (filePath) => {
      expect(RelativeTaskPathSchema.safeParse(filePath).success).toBe(true);
    },
  );

  it.each([
    "../secret.txt",
    "src/../../secret.txt",
    "src\\..\\..\\secret.txt",
    "/etc/passwd",
  ])("rejects %s", (filePath) => {
    expect(RelativeTaskPathSchema.safeParse(filePath).success).toBe(false);
  });
});

describe("WorkspaceFilePathSchema", () => {
  it.each([
    "src/index.ts",
    "./src/index.ts",
    "/etc/passwd",
    "/Users/sam/Photos/cat.png",
    "/c/Users/sam/Photos/cat.png",
  ])("accepts %s", (filePath) => {
    expect(WorkspaceFilePathSchema.safeParse(filePath).success).toBe(true);
  });

  it.each([
    "/Users/sam/Photos/../secret.txt",
    "/Users/sam//Photos/cat.png",
    "/Users/sam/Photos\\cat.png",
    "C:\\Users\\sam\\cat.png",
  ])("rejects %s", (filePath) => {
    expect(WorkspaceFilePathSchema.safeParse(filePath).success).toBe(false);
  });
});
