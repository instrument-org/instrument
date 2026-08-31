import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { contextOverflowNeedsRollover } from "./context-overflow";

const user = (parts: { type: string }[] = []) =>
  ({ metadata: {}, parts, role: "user" }) as unknown as
    SessionMessage.WithParts;

/** A user turn carrying the mark a reset leaves behind. */
const userAfterReset = () => user([{ type: "data-contextRollover" }]);

const assistant = (
  error?: SessionMessage.Assistant["metadata"]["error"],
  inputTokens?: number,
) =>
  ({
    metadata: {
      error,
      usage: inputTokens === undefined ? undefined : { inputTokens },
    },
    parts: [],
    role: "assistant",
  }) as unknown as SessionMessage.WithParts;

const overflow = () =>
  assistant({
    classification: "context-overflow",
    kind: "api-call",
    message: "prompt is too long",
    name: "AI_APICallError",
    url: "https://example.test/v1/messages",
  });

const answered = () => assistant(undefined, 5000);

describe("contextOverflowNeedsRollover", () => {
  it("is false for a session the model has not answered yet", () => {
    expect(contextOverflowNeedsRollover([user()])).toBe(false);
  });

  it("is false for a turn that succeeded", () => {
    expect(contextOverflowNeedsRollover([user(), answered()])).toBe(false);
  });

  it("is false for a failure that was not about size", () => {
    expect(
      contextOverflowNeedsRollover([
        user(),
        assistant({ kind: "api-key", message: "no key" }),
      ]),
    ).toBe(false);
  });

  it("finds the refusal behind the user message that follows it", () => {
    // The turn being assembled is always behind a newer user message, so
    // reading the last entry would never find the failure being asked about.
    expect(contextOverflowNeedsRollover([user(), overflow(), user()])).toBe(
      true,
    );
  });

  it("recognizes an overflow classified on an unknown-kind error", () => {
    expect(
      contextOverflowNeedsRollover([
        user(),
        assistant({
          classification: "context-overflow",
          kind: "unknown",
          message: "too many tokens",
        }),
      ]),
    ).toBe(true);
  });

  it("reports only the newest attempt, so a reset that worked ends it", () => {
    expect(
      contextOverflowNeedsRollover([user(), overflow(), user(), answered()]),
    ).toBe(false);
  });

  describe("the bound", () => {
    it("declines a second reset for a refusal the first one did not fix", () => {
      // A reset that did not fix it is evidence that resetting is not the fix.
      // Without this the task resets on every turn, spending another slice of
      // history each time on a request that was never going to be accepted.
      expect(
        contextOverflowNeedsRollover([
          user(),
          overflow(),
          userAfterReset(),
          overflow(),
          user(),
        ]),
      ).toBe(false);
    });

    it("lifts once a turn is counted, so a later refusal is rescued again", () => {
      expect(
        contextOverflowNeedsRollover([
          user(),
          overflow(),
          userAfterReset(),
          answered(),
          user(),
          overflow(),
          user(),
        ]),
      ).toBe(true);
    });
  });
});
