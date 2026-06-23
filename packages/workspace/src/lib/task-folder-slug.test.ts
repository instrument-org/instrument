import { describe, expect, it } from "vitest";

import { taskFolderSlug } from "./task-folder-slug";

describe("taskFolderSlug", () => {
  it.each([
    ["Add a dark mode toggle", "add-a-dark-mode-toggle"],
    ["  Fix the login bug!!! ", "fix-the-login-bug"],
    ["Refactor user_service.ts (v2)", "refactor-user-service-ts-v2"],
    // cspell:ignore café crème brûlée
    ["café crème brûlée", "cafe-creme-brulee"],
    ["Already-kebab-case", "already-kebab-case"],
    ["Build API v3 endpoint", "build-api-v3-endpoint"],
    // Non-latin / emoji only -> no usable tokens
    ["你好世界", ""],
    ["🚀🔥✨", ""],
    ["", ""],
    ["   ", ""],
    // cspell:ignore slugifies
  ])("slugifies %j -> %j", (input, expected) => {
    expect(taskFolderSlug(input)).toBe(expected);
  });

  it("truncates at a token boundary within the length cap", () => {
    const slug = taskFolderSlug(
      "one two three four five six seven eight nine ten eleven twelve",
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toMatchInlineSnapshot(
      `"one-two-three-four-five-six-seven-eight"`,
    );
  });

  it("hard-truncates a single oversized first token", () => {
    const slug = taskFolderSlug("a".repeat(100));
    expect(slug).toBe("a".repeat(40));
  });
});
