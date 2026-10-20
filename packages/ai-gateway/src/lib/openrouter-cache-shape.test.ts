import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type ModelMessage, streamText } from "ai";
import { describe, expect, it } from "vitest";

import {
  openRouterCacheShape,
  stabilizeCacheShape,
} from "./openrouter-cache-shape";

// The spelling `addCacheControlToMessages` sends, which the provider reads.
const marker = { anthropic: { cacheControl: { type: "ephemeral" } } };

/** The request bodies the OpenRouter provider sends for each list of messages. */
async function sentMessages(...requests: ModelMessage[][]) {
  const bodies: { messages: unknown[] }[] = [];
  const provider = createOpenRouter({
    apiKey: "test",
    fetch: openRouterCacheShape((_input, init) => {
      bodies.push(JSON.parse(init?.body as string) as { messages: unknown[] });
      return Promise.resolve(
        new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }),
  });
  for (const messages of requests) {
    const result = streamText({
      allowSystemInMessages: true,
      messages,
      model: provider("anthropic/claude-haiku-5.5"),
    });
    for await (const _part of result.stream) {
      // Drained so the request is sent.
    }
  }
  return bodies.map((body) => body.messages);
}

describe("openRouterCacheShape", () => {
  it("sends a message the same bytes whether or not it carries the newest marker", async () => {
    const system: ModelMessage = {
      content: "System.",
      providerOptions: marker,
      role: "system",
    };
    const context = (marked: boolean): ModelMessage => ({
      content: [
        {
          text: "<system_info>ctx</system_info>",
          type: "text",
          ...(marked ? { providerOptions: marker } : {}),
        },
      ],
      role: "user",
    });
    const ask = (marked: boolean): ModelMessage => ({
      content: [
        {
          text: "Total the column.",
          type: "text",
          ...(marked ? { providerOptions: marker } : {}),
        },
      ],
      role: "user",
    });
    const [first, second] = await sentMessages(
      [system, context(true), ask(true)],
      [
        system,
        context(false),
        ask(false),
        { content: "Done.", role: "assistant" },
        {
          content: [
            { providerOptions: marker, text: "And now?", type: "text" },
          ],
          role: "user",
        },
      ],
    );
    const unmarked = (messages: unknown[] | undefined) =>
      JSON.parse(
        JSON.stringify(messages, (key, value: unknown) =>
          key === "cache_control" ? undefined : value,
        ),
      ) as unknown;
    expect(unmarked(second?.slice(0, 3))).toEqual(unmarked(first));
    expect(second).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "cache_control": {
                "type": "ephemeral",
              },
              "text": "System.",
              "type": "text",
            },
          ],
          "role": "system",
        },
        {
          "content": [
            {
              "text": "<system_info>ctx</system_info>",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "text": "Total the column.",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "text": "Done.",
              "type": "text",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "cache_control": {
                "type": "ephemeral",
              },
              "text": "And now?",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });
});

describe("stabilizeCacheShape", () => {
  const init = (messages: unknown[]) => ({
    body: JSON.stringify({ messages }),
    method: "POST",
  });

  it("moves an assistant message's marker onto its last text part", () => {
    const result = stabilizeCacheShape(
      init([
        {
          cache_control: { type: "ephemeral" },
          content: "Reading it.",
          role: "assistant",
          tool_calls: [],
        },
      ]),
    );
    expect(JSON.parse(result?.body as string)).toMatchInlineSnapshot(`
      {
        "messages": [
          {
            "content": [
              {
                "cache_control": {
                  "type": "ephemeral",
                },
                "text": "Reading it.",
                "type": "text",
              },
            ],
            "role": "assistant",
            "tool_calls": [],
          },
        ],
      }
    `);
  });

  it("leaves a request with no marker exactly as it was", () => {
    const request = init([{ content: "hi", role: "user" }]);
    expect(stabilizeCacheShape(request)).toBe(request);
  });

  it("leaves an assistant message with only tool calls as it was", () => {
    const request = init([
      {
        cache_control: { type: "ephemeral" },
        content: null,
        role: "assistant",
        tool_calls: [],
      },
    ]);
    expect(stabilizeCacheShape(request)).toBe(request);
  });
});
