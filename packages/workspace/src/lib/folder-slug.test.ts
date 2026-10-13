import { describe, expect, it } from "vitest";

import { folderSlug } from "./folder-slug";

describe("folderSlug", () => {
  it.each([
    ["Add a dark mode toggle", "add-a-dark-mode-toggle"],
    ["  Fix the login bug!!! ", "fix-the-login-bug"],
    ["Refactor user_service.ts (v2)", "refactor-user-service-ts-v2"],
    ["café crème brûlée", "cafe-creme-brulee"],
    ["Already-kebab-case", "already-kebab-case"],
    ["Build API v3 endpoint", "build-api-v3-endpoint"],
    // Non-latin / emoji only -> no usable tokens
    ["你好世界", ""],
    ["🚀🔥✨", ""],
    ["", ""],
    ["   ", ""],
  ])("slugifies %j -> %j", (input, expected) => {
    expect(folderSlug(input)).toBe(expected);
  });

  it("counts a skill mention once, as the name the user typed", () => {
    expect(
      folderSlug(
        "[$commit-message](skill:commit-message) for the staged changes",
      ),
    ).toMatchInlineSnapshot(`"commit-message-for-the-staged-changes"`);
  });

  it("truncates at a token boundary within the length cap", () => {
    const slug = folderSlug(
      "one two three four five six seven eight nine ten eleven twelve",
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toMatchInlineSnapshot(
      `"one-two-three-four-five-six-seven-eight"`,
    );
  });

  it("hard-truncates a single oversized first token", () => {
    const slug = folderSlug("a".repeat(100));
    expect(slug).toBe("a".repeat(40));
  });
});
