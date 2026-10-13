import { describe, expect, it } from "vitest";

import { apiURL } from "./api-url";

describe("apiURL", () => {
  it("sends MiniMax replies to its Anthropic-compatible API and the rest to its OpenAI-compatible one", () => {
    const minimax = (path: `/${string}`, baseURL?: string) =>
      apiURL({ config: { baseURL, type: "minimax" }, path });

    expect({
      china: minimax("/messages", "https://api.minimaxi.com/v1"),
      messages: minimax("/messages"),
      models: minimax("/models"),
    }).toMatchInlineSnapshot(`
      {
        "china": "https://api.minimaxi.com/anthropic/v1/messages",
        "messages": "https://api.minimax.io/anthropic/v1/messages",
        "models": "https://api.minimax.io/v1/models",
      }
    `);
  });
});
