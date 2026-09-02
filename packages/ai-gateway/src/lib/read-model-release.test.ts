import { describe, expect, it } from "vitest";

import { outranksRelease, readModelRelease } from "./read-model-release";

describe("readModelRelease", () => {
  it("reads the release an id names", () => {
    const ids = [
      "claude-opus-5",
      "claude-haiku-4.5",
      "gpt-5.6-luna",
      "gemini-3.7-flash",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-pro-preview-05-06",
      "qwen3.8-max",
      "qwen3.8-2.4t-a95b",
      "kimi-k2.7-code",
      "minimax-m3:free",
      "deepseek-v4-flash-0731",
      "deepseek-v4-flash-latest",
      "grok-build-0.1",
    ];

    expect(Object.fromEntries(ids.map((id) => [id, readModelRelease(id)])))
      .toMatchInlineSnapshot(`
      {
        "claude-haiku-4.5": {
          "build": undefined,
          "family": "claude",
          "qualifierCount": 0,
          "series": "claude-haiku|",
          "version": 4.5,
        },
        "claude-opus-5": {
          "build": undefined,
          "family": "claude",
          "qualifierCount": 0,
          "series": "claude-opus|",
          "version": 5,
        },
        "deepseek-v4-flash-0731": {
          "build": 731,
          "family": "deepseek",
          "qualifierCount": 0,
          "series": "deepseek-v|flash",
          "version": 4,
        },
        "deepseek-v4-flash-latest": {
          "build": undefined,
          "family": "deepseek",
          "qualifierCount": 1,
          "series": "deepseek-v|flash",
          "version": 4,
        },
        "gemini-2.5-pro-preview-05-06": {
          "build": 506,
          "family": "gemini",
          "qualifierCount": 1,
          "series": "gemini|pro",
          "version": 2.5,
        },
        "gemini-3.1-flash-lite-preview": {
          "build": undefined,
          "family": "gemini",
          "qualifierCount": 1,
          "series": "gemini|flash-lite",
          "version": 3.1,
        },
        "gemini-3.7-flash": {
          "build": undefined,
          "family": "gemini",
          "qualifierCount": 0,
          "series": "gemini|flash",
          "version": 3.7,
        },
        "gpt-5.6-luna": {
          "build": undefined,
          "family": "gpt",
          "qualifierCount": 0,
          "series": "gpt|luna",
          "version": 5.6,
        },
        "grok-build-0.1": {
          "build": undefined,
          "family": "grok",
          "qualifierCount": 0,
          "series": "grok-build|",
          "version": 0.1,
        },
        "kimi-k2.7-code": {
          "build": undefined,
          "family": "kimi",
          "qualifierCount": 0,
          "series": "kimi-k|code",
          "version": 2.7,
        },
        "minimax-m3:free": {
          "build": undefined,
          "family": "minimax",
          "qualifierCount": 1,
          "series": "minimax-m|",
          "version": 3,
        },
        "qwen3.8-2.4t-a95b": {
          "build": undefined,
          "family": "qwen",
          "qualifierCount": 0,
          "series": "qwen|2.4t-a95b",
          "version": 3.8,
        },
        "qwen3.8-max": {
          "build": undefined,
          "family": "qwen",
          "qualifierCount": 0,
          "series": "qwen|max",
          "version": 3.8,
        },
      }
    `);
  });

  it.each([
    "auto",
    "deepseek-chat",
    "gpt-oss-120b",
    // A letter straight after the digits belongs to the name, not the version.
    "glm-5v-turbo",
    "gpt-4o",
  ])("leaves %s unversioned", (canonicalId) => {
    expect(readModelRelease(canonicalId)).toBeUndefined();
  });
});

describe("outranksRelease", () => {
  it.each([
    { earlier: "gemini-3.5-flash", later: "gemini-3.7-flash" },
    { earlier: "kimi-k2.6", later: "kimi-k3" },
    { earlier: "deepseek-v4-flash", later: "deepseek-v4-flash-0731" },
    { earlier: "deepseek-v4-flash-0423", later: "deepseek-v4-flash-0731" },
    // An alias and the build it points at are one release, and the plainer id
    // is the one worth showing.
    { earlier: "deepseek-v4-flash-latest", later: "deepseek-v4-flash" },
    {
      earlier: "gemini-3.1-flash-lite-preview",
      later: "gemini-3.1-flash-lite",
    },
  ])("ranks $later over $earlier", ({ earlier, later }) => {
    const earlierRelease = readModelRelease(earlier);
    const laterRelease = readModelRelease(later);
    if (!earlierRelease || !laterRelease) {
      throw new Error("expected both ids to carry a version");
    }

    expect(outranksRelease(laterRelease, earlierRelease)).toBe(true);
    expect(outranksRelease(earlierRelease, laterRelease)).toBe(false);
  });

  it.each([
    { a: "gemini-3.7-flash", b: "gemini-3.7-pro" },
    { a: "claude-opus-5", b: "claude-sonnet-5" },
  ])("ranks neither of $a and $b over the other", ({ a, b }) => {
    const first = readModelRelease(a);
    const second = readModelRelease(b);
    if (!first || !second) {
      throw new Error("expected both ids to carry a version");
    }

    expect(outranksRelease(first, second)).toBe(false);
    expect(outranksRelease(second, first)).toBe(false);
  });
});
