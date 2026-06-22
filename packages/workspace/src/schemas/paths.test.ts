import { describe, expect, it } from "vitest";

import { RelativeTaskPathSchema } from "./paths";

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
