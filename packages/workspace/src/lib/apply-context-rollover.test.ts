import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import {
  applyContextRollover,
  contextRolloverWouldReclaim,
} from "./apply-context-rollover";
import { sanitizeSurrogates } from "./sanitize-model-text";

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

const textOf = (entry: SessionMessage.WithParts | undefined) =>
  (entry?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

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

  it("cuts the newest user message down rather than dropping it", () => {
    // The turn the model is being asked to answer. Dropped, the request reads
    // as though the user said nothing and gets answered out of older context.
    const rolled = applyContextRollover({
      messages: [
        message("u1", "user", `THE ASK${"y".repeat(50_000)}AND THE FOLLOW-UP`),
        message("a1", "assistant"),
      ],
      rolledOverAfterMessageId: id("a1"),
    });

    expect(ids(rolled)).toEqual(["u1"]);

    const text = textOf(rolled[0]);
    expect(text.startsWith("THE ASK")).toBe(true);
    expect(text.endsWith("AND THE FOLLOW-UP")).toBe(true);
    expect(/\[context rollover[^\]]*\]/.exec(text)?.[0]).toMatchInlineSnapshot(
      `"[context rollover omitted 10024 characters here; this bracketed line is not the user's text]"`,
    );
  });

  it("leaves a user message that fits the budget exactly as it was", () => {
    const original = message("u1", "user", "z".repeat(39_000));
    const rolled = applyContextRollover({
      messages: [original, message("a1", "assistant")],
      rolledOverAfterMessageId: id("a1"),
    });

    expect(ids(rolled)).toEqual(["u1"]);
    expect(rolled[0]).toBe(original);
  });

  it("spends the budget on the newest message before any older one", () => {
    const rolled = applyContextRollover({
      messages: [
        message("u1", "user", "the constraint that still binds"),
        message("u2", "user", "y".repeat(50_000)),
        message("a1", "assistant"),
      ],
      rolledOverAfterMessageId: id("a1"),
    });

    expect(ids(rolled)).toEqual(["u2"]);
  });

  it("keeps a text part that lies wholly inside the tail budget", () => {
    // Two text parts: the first straddles the tail boundary, the second sits
    // entirely inside the tail region and must survive whole. The second's
    // start has to fall within its own length of the boundary, because a part
    // further past it survives anyway through slice clamping.
    const twoParts = {
      id: id("u1"),
      parts: [
        { text: "a".repeat(40_000), type: "text" },
        { text: "b".repeat(15_000), type: "text" },
      ],
      role: "user",
    } as unknown as SessionMessage.WithParts;

    const rolled = applyContextRollover({
      messages: [twoParts, message("a1", "assistant")],
      rolledOverAfterMessageId: id("a1"),
    });

    const parts = rolled[0]?.parts ?? [];
    const first = parts[0]?.type === "text" ? parts[0].text : "";
    const second = parts[1]?.type === "text" ? parts[1].text : "";

    expect(first).toContain("[context rollover omitted");
    expect(second).toBe("b".repeat(15_000));
  });

  it("leaves no half characters at the edges of the cut", () => {
    // The eleven trailing plain characters shift the tail's cut onto the low
    // half of an emoji, which is the half a plain slice would keep.
    const rolled = applyContextRollover({
      messages: [
        message("u1", "user", "🙈".repeat(20_000) + "x".repeat(11)),
        message("a1", "assistant"),
      ],
      rolledOverAfterMessageId: id("a1"),
    });

    const text = textOf(rolled[0]);
    expect(sanitizeSurrogates(text)).toBe(text);
  });
});
