import { describe, expect, it } from "vitest";

import { fromChatModelText } from "./from-chat-model-text";

describe("fromChatModelText", () => {
  // A task told no card reached the person reported a folder it could ask
  // for as refused, and the chat relayed that while the card still waited.
  it("tells a task it asks for a folder itself and waiting on it is normal", () => {
    const text = fromChatModelText({
      kind: "assignment",
      text: "Read the pantry notes.",
    });
    expect(text).not.toMatch(/no question, folder request, or app card/);
    expect(text).toContain(
      "ask for it with `ask_permission`, and their answer wakes you here",
    );
    expect(text).toContain(
      "Waiting on that card is normal and is not a refusal",
    );
  });

  it("passes a later message through as written", () => {
    expect(
      fromChatModelText({ kind: "message", text: "Make it shorter." }),
    ).toBe("Make it shorter.");
  });
});
