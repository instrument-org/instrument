import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../../schemas/session/message";
import { coldTail, suggestionFrom } from "./next-message";

function usage(
  inputTokens: number,
  outputTokens: number,
  details: SessionMessage.Usage["inputTokenDetails"],
): SessionMessage.Usage {
  return {
    inputTokenDetails: details,
    inputTokens,
    outputTokenDetails: {},
    outputTokens,
  };
}

describe("coldTail", () => {
  it.each([
    ["mostly cached", usage(30_000, 200, { cacheReadTokens: 29_000 }), false],
    [
      "a long uncached tail",
      usage(30_000, 200, { cacheReadTokens: 15_000 }),
      true,
    ],
    ["a long reply", usage(30_000, 11_000, { cacheReadTokens: 30_000 }), true],
    [
      "the provider's own uncached count",
      usage(30_000, 0, { noCacheTokens: 12_000 }),
      true,
    ],
    ["no cache figures", usage(30_000, 200, {}), false],
    ["no usage", undefined, false],
  ])("judges %s", (_name, given, expected) => {
    expect(coldTail(given)).toBe(expected);
  });
});

describe("suggestionFrom", () => {
  it.each([
    ["Move the duplicates to the Trash", "Move the duplicates to the Trash"],
    ['"ok, enabled it. try again"', "ok, enabled it. try again"],
    ["<think>they want the PDFs</think>Summarize both", "Summarize both"],
    ["Summarize both\nbecause they asked for three", "Summarize both"],
    ["", undefined],
    ["none", undefined],
    ["(nothing)", undefined],
    ["NONE", undefined],
    [
      "The conversation just ended on a thanks, so there's no next message to suggest.",
      undefined,
    ],
    [`Do ${"this and that ".repeat(12)}`, undefined],
  ])("reads %j as %j", (answer, expected) => {
    expect(suggestionFrom(answer)).toBe(expected);
  });
});
