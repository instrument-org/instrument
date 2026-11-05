import { describe, expect, it } from "vitest";

import { isLatestAttempt, isRetriedAway } from "./retried-away";

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

describe("isLatestAttempt", () => {
  const failed = {
    metadata: { error: { message: "fetch failed" } },
    parts: [{ type: "step-start" }],
    role: "assistant",
  };
  const silent = {
    metadata: {},
    parts: [{ type: "step-start" }],
    role: "assistant",
  };
  const opening = { metadata: {}, parts: [], role: "assistant" };
  const speaking = {
    metadata: {},
    parts: [{ type: "step-start" }, { text: "Hi", type: "text" }],
    role: "assistant",
  };
  const user = { metadata: {}, parts: [], role: "user" };

  it.each([
    ["the last message", [failed], 0, true],
    [
      "above an attempt that has started and said nothing",
      [failed, silent],
      0,
      true,
    ],
    ["above an attempt with no parts at all", [failed, opening], 0, true],
    ["above an attempt that has said something", [failed, speaking], 0, false],
    ["above an attempt that failed too", [failed, failed], 0, false],
    ["above the person's next message", [failed, user], 0, false],
    [
      "two above an attempt that said nothing",
      [failed, failed, silent],
      0,
      false,
    ],
  ])("%s", (_name, messages, index, expected) => {
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only role, metadata.error and part types are read
      isLatestAttempt(messages as never, index),
    ).toBe(expected);
  });
});
