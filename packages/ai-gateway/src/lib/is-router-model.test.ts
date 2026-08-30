import { OUR_MODELS } from "@instrument-org/shared";
import { describe, expect, it } from "vitest";

import { isRouterModel } from "./is-router-model";

describe("isRouterModel", () => {
  it.each([
    [OUR_MODELS.text.id, true],
    ["openrouter/auto", true],
    ["openrouter/auto-beta", true],
    ["openai/gpt-5.6-luna", false],
    ["anthropic/claude-sonnet-4.5", false],
    // Named outright rather than matched on a prefix, so a model whose name
    // merely starts with the word is not mistaken for a router.
    ["openrouter/autopilot", false],
    // Our image alias routes too, but nothing reads a served model for images
    // yet, so claiming it here would describe a behavior that does not exist.
    [OUR_MODELS.image.id, false],
  ])("reads %s as %s", (providerId, expected) => {
    expect(isRouterModel({ providerId })).toBe(expected);
  });

  it("reads a missing model as not a router", () => {
    expect(isRouterModel(undefined)).toBe(false);
  });
});
