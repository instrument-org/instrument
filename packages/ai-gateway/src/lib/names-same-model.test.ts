import { describe, expect, it } from "vitest";

import { namesSameModel } from "./names-same-model";

describe("namesSameModel", () => {
  it.each([
    // The same id, which is every provider that echoes what it was sent.
    ["anthropic/claude-haiku-4.5", "anthropic/claude-haiku-4.5", true],
    // An alias resolved to the build behind it. OpenAI's catalog carries the
    // alias, so without this every turn on a direct OpenAI key reads as a
    // substitution.
    ["gpt-5.6-luna", "gpt-5.6-luna-2026-01-15", true],
    ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929", true],
    // A different model that happens to share a prefix.
    ["gpt-5", "gpt-5-mini", false],
    ["claude-sonnet-4-5", "claude-sonnet-4-5-thinking", false],
    // A different model outright, which is the substitution worth showing.
    ["anthropic/claude-fable-5", "anthropic/claude-opus-5", false],
    ["instrument/auto", "openai/gpt-5.6-luna", false],
    // The requested id is a suffix of the served one without the separator.
    ["gpt-5", "notgpt-5", false],
  ])("reads %s served as %s as %s", (requested, served, expected) => {
    expect(namesSameModel(requested, served)).toBe(expected);
  });

  // Nothing to compare against is not a match: a served id we cannot place
  // against a request is still the only thing we know about the answer.
  it("reads a missing request as a different model", () => {
    expect(namesSameModel(undefined, "openai/gpt-5.6-luna")).toBe(false);
  });
});
