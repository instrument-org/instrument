import { describe, expect, it } from "vitest";

import {
  claudeCodeRelease,
  compareClaudeCodeVersions,
  runsClaudeCode,
} from "./release";

describe("Claude Code versions", () => {
  it.each([
    ["2.1.220", false],
    ["2.1.284", false],
    ["2.1.285", true],
    ["2.1.300", true],
    ["2.2.0", true],
    ["3.0.0", true],
  ])("runs %s: %s", (version, runs) => {
    expect(runsClaudeCode(version)).toBe(runs);
  });

  it("orders by number, not by text", () => {
    expect(
      ["2.1.300", "2.1.99", "2.1.285"].toSorted(compareClaudeCodeVersions),
    ).toEqual(["2.1.99", "2.1.285", "2.1.300"]);
  });

  it("drives a Claude Code it runs", () => {
    // An Agent SDK pinned to an older build would ship one the app refuses.
    const release = claudeCodeRelease();

    expect(release === undefined || runsClaudeCode(release.version)).toBe(true);
  });
});
