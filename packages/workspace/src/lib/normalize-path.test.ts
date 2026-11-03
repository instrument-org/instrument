import { describe, expect, it } from "vitest";

import { normalizePath } from "./normalize-path";

describe("normalizePath", () => {
  it.each([
    ["turns backslashes into slashes", "path\\to/file.txt", "path/to/file.txt"],
    [
      "collapses doubled backslashes",
      "path\\\\to\\\\file.txt",
      "path/to/file.txt",
    ],
    ["drops a leading ./", ".\\path\\to\\file.txt", "path/to/file.txt"],
    ["keeps an empty path empty", "", ""],
  ])("%s", (_label, input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});
