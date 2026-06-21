import {
  describe,
  expect,
  it,
} from "vitest";

import {
  RelativeProjectPathSchema,
} from "./paths";

describe("RelativeProjectPathSchema", () => {
  it.each(["src/index.ts", "./src/index.ts", "file.txt"])(
    "accepts %s",
    (filePath) => {
      expect(RelativeProjectPathSchema.safeParse(filePath).success).toBe(true);
    },
  );

  it.each([
    "../secret.txt",
    "src/../../secret.txt",
    "src\\..\\..\\secret.txt",
    "/etc/passwd",
  ])("rejects %s", (filePath) => {
    expect(RelativeProjectPathSchema.safeParse(filePath).success).toBe(false);
  });
});
