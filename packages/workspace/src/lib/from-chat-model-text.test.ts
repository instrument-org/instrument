import { describe, expect, it } from "vitest";

import { fromChatModelText } from "./from-chat-model-text";

describe("fromChatModelText", () => {
  // A task that ran into a folder the person keeps closed raised a card they
  // see; told none reached them, it reported the folder as refused, and the
  // chat relayed that while the card still waited for an answer.
  it("tells a task that its card reaches the person and waiting on it is normal", () => {
    const text = fromChatModelText({
      kind: "assignment",
      text: "Read the pantry notes.",
    });
    expect(text).not.toMatch(/no question, folder request, or app card/);
    expect(text).toContain(
      "reaching for it shows them a card, and their answer wakes you here",
    );
    expect(text).toContain("Waiting on a card is normal and is not a refusal");
  });

  it("passes a later message through as written", () => {
    expect(
      fromChatModelText({ kind: "message", text: "Make it shorter." }),
    ).toBe("Make it shorter.");
  });
});
