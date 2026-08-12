import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import {
  applyContextRollover,
  contextRolloverWouldReclaim,
} from "./apply-context-rollover";

const id = (value: string) => value as StoreId.Message;

const message = (
  messageId: string,
  role: "assistant" | "user",
  text = "hi",
): SessionMessage.WithParts =>
  ({
    id: id(messageId),
    parts: [{ text, type: "text" }],
    role,
  }) as unknown as SessionMessage.WithParts;

const ids = (messages: readonly SessionMessage.WithParts[]) =>
  messages.map((entry) => entry.id);

const conversation = [
  message("u1", "user", "the constraint that still binds"),
  message("a1", "assistant"),
  message("u2", "user"),
  message("a2", "assistant"),
  message("u3", "user"),
  message("a3", "assistant"),
];

describe("applyContextRollover", () => {
  it("changes nothing when the session has never rolled over", () => {
    expect(
      ids(
        applyContextRollover({
          messages: conversation,
          rolledOverAfterMessageId: undefined,
        }),
      ),
    ).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });

  it("keeps every user message and drops the model's turns before the boundary", () => {
    expect(
      ids(
        applyContextRollover({
          messages: conversation,
          rolledOverAfterMessageId: id("a2"),
        }),
      ),
    ).toEqual(["u1", "u2", "u3", "a3"]);
  });

  it("leaves everything after the boundary untouched", () => {
    expect(
      ids(
        applyContextRollover({
          messages: conversation,
          rolledOverAfterMessageId: id("u1"),
        }),
      ),
    ).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });

  it("carries the whole history when the boundary names a message that is gone", () => {
    expect(
      ids(
        applyContextRollover({
          messages: conversation,
          rolledOverAfterMessageId: id("deleted"),
        }),
      ),
    ).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });

  it("drops the oldest user messages rather than carrying an unsendable history", () => {
    const huge = "x".repeat(30_000);
    const rolled = applyContextRollover({
      messages: [
        message("u1", "user", huge),
        message("u2", "user", huge),
        message("a1", "assistant"),
      ],
      rolledOverAfterMessageId: id("a1"),
    });

    // Both would be 60,000 characters against a 40,000 budget, so the older one
    // goes and the newest survives whole.
    expect(ids(rolled)).toEqual(["u2"]);
  });

  it("reclaims nothing worth having until model turns have built up", () => {
    // The loop this prevents: a task whose fixed parts already fill the window
    // is exhausted on every step, so without a floor it resets on every step,
    // deleting the work the model just did and making it repeat itself.
    expect(contextRolloverWouldReclaim([])).toBe(false);
    expect(
      contextRolloverWouldReclaim([
        message("u1", "user"),
        message("a1", "assistant"),
        message("a2", "assistant"),
        message("a3", "assistant"),
      ]),
    ).toBe(false);
  });

  it("is worth doing once enough model turns have built up", () => {
    expect(
      contextRolloverWouldReclaim([
        message("a1", "assistant"),
        message("a2", "assistant"),
        message("a3", "assistant"),
        message("a4", "assistant"),
      ]),
    ).toBe(true);
  });

  it("never splits a retained user message", () => {
    const rolled = applyContextRollover({
      messages: [
        message("u1", "user", "y".repeat(50_000)),
        message("a1", "assistant"),
      ],
      rolledOverAfterMessageId: id("a1"),
    });

    expect(rolled).toEqual([]);
  });
});
