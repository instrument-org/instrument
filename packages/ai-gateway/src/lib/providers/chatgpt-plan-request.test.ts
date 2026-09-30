import { describe, expect, it } from "vitest";

import {
  collapseResponsesStream,
  rewriteChatGPTPlanResponsesBody,
} from "./chatgpt-plan-request";

describe("rewriteChatGPTPlanResponsesBody", () => {
  it("forces streaming without storage and drops refused fields", () => {
    expect(
      rewriteChatGPTPlanResponsesBody({
        include: ["reasoning.encrypted_content"],
        input: [
          { content: "Be brief.", role: "system" },
          { content: [{ text: "Hi", type: "input_text" }], role: "user" },
        ],
        max_output_tokens: 32_000,
        model: "gpt-6.1-sol",
        previous_response_id: "resp_1",
        store: true,
        temperature: 0,
        user: "cache-key",
      }),
    ).toMatchInlineSnapshot(`
      {
        "body": {
          "include": [
            "reasoning.encrypted_content",
          ],
          "input": [
            {
              "content": "Be brief.",
              "role": "developer",
            },
            {
              "content": [
                {
                  "text": "Hi",
                  "type": "input_text",
                },
              ],
              "role": "user",
            },
          ],
          "model": "gpt-6.1-sol",
          "store": false,
          "stream": true,
        },
        "streamed": false,
      }
    `);
  });
});

describe("collapseResponsesStream", () => {
  it("answers with the completed response", async () => {
    const stream = [
      `data: ${JSON.stringify({ type: "response.created" })}`,
      `data: ${JSON.stringify({ response: { id: "resp_1", output: [] }, type: "response.completed" })}`,
      "",
    ].join("\n\n");
    const response = await collapseResponsesStream(new Response(stream));
    expect([response.status, await response.json()]).toMatchInlineSnapshot(`
      [
        200,
        {
          "id": "resp_1",
          "output": [],
        },
      ]
    `);
  });

  it("puts back items the completed response left out", async () => {
    const item = {
      content: [{ text: "Christmas countdown", type: "output_text" }],
      role: "assistant",
      type: "message",
    };
    const stream = [
      `data: ${JSON.stringify({ item, type: "response.output_item.done" })}`,
      `data: ${JSON.stringify({ response: { id: "resp_1", output: [] }, type: "response.completed" })}`,
      "",
    ].join("\n\n");
    const response = await collapseResponsesStream(new Response(stream));
    expect(await response.json()).toMatchObject({ output: [item] });
  });

  it("answers a usage limit with a 429", async () => {
    const stream = `data: ${JSON.stringify({
      response: {
        error: {
          code: "subscription_sharing_usage_limit_exceeded",
          message: "Limit",
        },
      },
      type: "response.failed",
    })}\n\n`;
    const response = await collapseResponsesStream(new Response(stream));
    expect(response.status).toBe(429);
  });
});
