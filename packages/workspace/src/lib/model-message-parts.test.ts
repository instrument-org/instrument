import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { mapModelMessageParts } from "./model-message-parts";

/** One message per role, holding every text and media slot the union allows. */
const everySlot: ModelMessage[] = [
  { content: "system prompt", role: "system" },
  {
    content: [
      { text: "user text", type: "text" },
      { data: "b2xk", mediaType: "image/png", type: "file" },
      { image: "b2xk", mediaType: "image/png", type: "image" },
    ],
    role: "user",
  },
  {
    content: [
      { text: "assistant text", type: "text" },
      { data: "b2xk", mediaType: "image/png", type: "file" },
      { text: "a thought", type: "reasoning" },
      {
        input: {},
        toolCallId: "call-1",
        toolName: "search",
        type: "tool-call",
      },
      {
        output: { type: "text", value: "provider-executed result" },
        toolCallId: "call-1",
        toolName: "search",
        type: "tool-result",
      },
    ],
    role: "assistant",
  },
  {
    content: [
      {
        output: { type: "text", value: "text output" },
        toolCallId: "call-2",
        toolName: "bash",
        type: "tool-result",
      },
      {
        output: { type: "error-text", value: "error output" },
        toolCallId: "call-3",
        toolName: "bash",
        type: "tool-result",
      },
      {
        output: {
          type: "content",
          value: [
            { text: "caption", type: "text" },
            { data: "b2xk", mediaType: "image/png", type: "media" },
            { data: "b2xk", mediaType: "image/png", type: "image-data" },
            { data: "b2xk", mediaType: "application/pdf", type: "file-data" },
            { type: "image-url", url: "https://example.com/chart.png" },
          ],
        },
        toolCallId: "call-4",
        toolName: "read_file",
        type: "tool-result",
      },
      {
        output: { type: "json", value: { ok: true } },
        toolCallId: "call-5",
        toolName: "bash",
        type: "tool-result",
      },
      {
        approvalId: "approval-1",
        approved: false,
        reason: "denial reason",
        type: "tool-approval-response",
      },
    ],
    role: "tool",
  },
];

describe("mapModelMessageParts", () => {
  it("reaches every text and media slot from a single visitor", async () => {
    // The snapshot is the contract: a slot the traversal stops visiting shows up
    // here as untagged text or surviving media, and the three deliberate
    // omissions -- reasoning, a tool call's input, a json output -- are visible
    // as the parts that came through unchanged.
    const result = await mapModelMessageParts(everySlot, {
      media: ({ mediaType }) => ({
        note: `<dropped ${mediaType ?? "media with no declared type"}>`,
        state: "dropped",
      }),
      text: (text) => `[${text}]`,
    });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": "[system prompt]",
          "role": "system",
        },
        {
          "content": [
            {
              "text": "[user text]",
              "type": "text",
            },
            {
              "text": "<dropped image/png>",
              "type": "text",
            },
            {
              "text": "<dropped image/png>",
              "type": "text",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "text": "[assistant text]",
              "type": "text",
            },
            {
              "text": "<dropped image/png>",
              "type": "text",
            },
            {
              "text": "a thought",
              "type": "reasoning",
            },
            {
              "input": {},
              "toolCallId": "call-1",
              "toolName": "search",
              "type": "tool-call",
            },
            {
              "output": {
                "type": "text",
                "value": "[provider-executed result]",
              },
              "toolCallId": "call-1",
              "toolName": "search",
              "type": "tool-result",
            },
          ],
          "role": "assistant",
        },
        {
          "content": [
            {
              "output": {
                "type": "text",
                "value": "[text output]",
              },
              "toolCallId": "call-2",
              "toolName": "bash",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "error-text",
                "value": "[error output]",
              },
              "toolCallId": "call-3",
              "toolName": "bash",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "content",
                "value": [
                  {
                    "text": "[caption]",
                    "type": "text",
                  },
                  {
                    "text": "<dropped image/png>",
                    "type": "text",
                  },
                  {
                    "text": "<dropped image/png>",
                    "type": "text",
                  },
                  {
                    "text": "<dropped application/pdf>",
                    "type": "text",
                  },
                  {
                    "type": "image-url",
                    "url": "https://example.com/chart.png",
                  },
                ],
              },
              "toolCallId": "call-4",
              "toolName": "read_file",
              "type": "tool-result",
            },
            {
              "output": {
                "type": "json",
                "value": {
                  "ok": true,
                },
              },
              "toolCallId": "call-5",
              "toolName": "bash",
              "type": "tool-result",
            },
            {
              "approvalId": "approval-1",
              "approved": false,
              "reason": "[denial reason]",
              "type": "tool-approval-response",
            },
          ],
          "role": "tool",
        },
      ]
    `);
  });

  it("puts replaced bytes back in the form the slot carries", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { data: "b2xk", mediaType: "image/png", type: "file" },
          {
            data: "data:image/png;base64,b2xk",
            mediaType: "image/png",
            type: "file",
          },
          {
            data: new Uint8Array([1, 2, 3]),
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
      {
        content: [
          {
            output: {
              type: "content",
              value: [{ data: "b2xk", mediaType: "image/png", type: "media" }],
            },
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    const result = await mapModelMessageParts(messages, {
      media: () => ({
        bytes: Buffer.from("new"),
        mediaType: "image/webp",
        state: "replaced",
      }),
    });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "data": "bmV3",
              "mediaType": "image/webp",
              "type": "file",
            },
            {
              "data": "data:image/webp;base64,bmV3",
              "mediaType": "image/webp",
              "type": "file",
            },
            {
              "data": Uint8Array [
                110,
                101,
                119,
              ],
              "mediaType": "image/webp",
              "type": "file",
            },
          ],
          "role": "user",
        },
        {
          "content": [
            {
              "output": {
                "type": "content",
                "value": [
                  {
                    "data": "bmV3",
                    "mediaType": "image/webp",
                    "type": "media",
                  },
                ],
              },
              "toolCallId": "call-1",
              "toolName": "read_file",
              "type": "tool-result",
            },
          ],
          "role": "tool",
        },
      ]
    `);
  });

  it("shows a visitor an image part that declares no media type", async () => {
    // The one shape that may omit its type. Skipping it here would make the
    // traversal the place a media part opts out of every pass at once, which is
    // the thing it exists to prevent.
    const seen: (string | undefined)[] = [];
    const messages: ModelMessage[] = [
      { content: [{ image: "b2xk", type: "image" }], role: "user" },
    ];

    await mapModelMessageParts(messages, {
      media: ({ mediaType }) => {
        seen.push(mediaType);
        return { state: "unchanged" };
      },
    });

    expect(seen).toEqual([undefined]);
  });

  it("hands a visitor no bytes for media the provider fetches itself", async () => {
    const seen: (Buffer | undefined)[] = [];
    const messages: ModelMessage[] = [
      {
        content: [
          {
            data: new URL("https://example.com/chart.png"),
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    await mapModelMessageParts(messages, {
      media: ({ bytes }) => {
        seen.push(bytes);
        return { state: "unchanged" };
      },
    });

    expect(seen).toEqual([undefined]);
  });

  it("leaves messages alone when no visitor is given", async () => {
    await expect(mapModelMessageParts(everySlot, {})).resolves.toEqual(
      everySlot,
    );
  });
});
