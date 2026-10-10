import { describe, expect, it } from "vitest";

import { ChatStateSchema } from "./chat-state";

describe("ChatStateSchema", () => {
  // The chat screen waits on this answer, so failing it left the chat
  // spinning instead of opening on the default model.
  it("answers a stored model URI it cannot parse as no pick", () => {
    const state = ChatStateSchema.parse({
      selectedModelURI:
        "openai/gpt-5.6-sol?provider=retired-provider&providerConfigId=gone",
    });

    expect(state.selectedModelURI).toBeUndefined();
  });
});
