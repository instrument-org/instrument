import { describe, expect, it } from "vitest";

import { isRetriedAway } from "./retried-away";

const refused = {
  error: {
    classification: "unsendable-content" as const,
    kind: "api-call" as const,
    message: "an image in the conversation could not be processed",
    name: "AI_APICallError",
    url: "claude-account://",
  },
};
const goneOn = { endedTurn: false, isLastMessage: false };

describe("isRetriedAway", () => {
  it.each([
    [
      "a refusal whose media the retry left out",
      { ...refused, refusedMedia: ["digest"] },
      goneOn,
      true,
    ],
    ["a refusal with nothing left out", refused, goneOn, false],
    [
      "a refusal the turn ended on",
      { ...refused, refusedMedia: ["digest"] },
      { endedTurn: true, isLastMessage: false },
      false,
    ],
    [
      "a refusal that is the last message",
      { ...refused, refusedMedia: ["digest"] },
      { endedTurn: false, isLastMessage: true },
      false,
    ],
  ])("%s", (_name, metadata, position, expected) => {
    expect(isRetriedAway(metadata, position)).toBe(expected);
  });
});
