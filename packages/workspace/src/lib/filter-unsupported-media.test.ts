import type { AIGatewayModel } from "@instrument-org/ai-gateway";
import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { filterUnsupportedMedia } from "./filter-unsupported-media";

const createModel = (
  features: AIGatewayModel.ModelFeatures[],
): AIGatewayModel.Type => createMockAIGatewayModel({ features });

describe("filterUnsupportedMedia", () => {
  it("should pass through messages without file parts", async () => {
    const messages: ModelMessage[] = [
      {
        content: "Hello",
        role: "user",
      },
      {
        content: [{ text: "Hi there", type: "text" }],
        role: "assistant",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should keep audio files when model supports inputAudio", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Listen to this", type: "text" },
          {
            data: "data:base64-audio",
            mediaType: "audio/mp3",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputAudio", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should replace audio files when model does not support inputAudio", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Listen to this", type: "text" },
          {
            data: "data:base64-audio",
            mediaType: "audio/mp3",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Listen to this",
              "type": "text",
            },
            {
              "text": "<system_note>
      Audio file removed - your model lacks audio input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should keep image files when model supports inputImage", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Look at this", type: "text" },
          {
            data: "base64imagedata",
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputImage", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should replace image files when model does not support inputImage", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Look at this", type: "text" },
          {
            data: "base64imagedata",
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Look at this",
              "type": "text",
            },
            {
              "text": "<system_note>
      Image file removed - your model lacks image input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should handle multiple media types in the same message", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Check these out", type: "text" },
          {
            data: "base64imagedata",
            mediaType: "image/jpeg",
            type: "file",
          },
          {
            data: "data:base64-audio",
            mediaType: "audio/wav",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Check these out",
              "type": "text",
            },
            {
              "text": "<system_note>
      Image file removed - your model lacks image input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
            {
              "text": "<system_note>
      Audio file removed - your model lacks audio input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should filter selectively based on model features", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            data: "base64imagedata",
            mediaType: "image/png",
            type: "file",
          },
          {
            data: "data:base64-audio",
            mediaType: "audio/mp3",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputImage", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "data": "base64imagedata",
              "mediaType": "image/png",
              "type": "file",
            },
            {
              "text": "<system_note>
      Audio file removed - your model lacks audio input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should handle messages with string content", async () => {
    const messages: ModelMessage[] = [
      {
        content: "System message",
        role: "system",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should handle various audio mime types", async () => {
    const audioTypes = ["audio/mp3", "audio/wav", "audio/ogg", "audio/mpeg"];

    for (const mediaType of audioTypes) {
      const messages: ModelMessage[] = [
        {
          content: [
            {
              data: "base64data",
              mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ];

      const model = createModel(["inputText", "outputText"]);
      const result = await filterUnsupportedMedia({ messages, model });

      expect(result).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "text": "<system_note>
        Audio file removed - your model lacks audio input capability.
        Convert it to a different format or request the user to provide it in a different format if you need to access it.
        </system_note>",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ]
      `);
    }
  });

  it("should handle various image mime types", async () => {
    const imageTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
    ];

    for (const mediaType of imageTypes) {
      const messages: ModelMessage[] = [
        {
          content: [
            {
              data: "base64data",
              mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ];

      const model = createModel(["inputText", "outputText"]);
      const result = await filterUnsupportedMedia({ messages, model });

      expect(result).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "text": "<system_note>
        Image file removed - your model lacks image input capability.
        Convert it to a different format or request the user to provide it in a different format if you need to access it.
        </system_note>",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ]
      `);
    }
  });

  it("should not filter file types outside every media category", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            data: "base64data",
            mediaType: "application/zip",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should keep video files when model supports inputVideo", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Watch this", type: "text" },
          {
            data: "data:video",
            mediaType: "video/mp4",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputVideo", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should replace video files when model does not support inputVideo", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Watch this", type: "text" },
          {
            data: "data:video",
            mediaType: "video/mp4",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Watch this",
              "type": "text",
            },
            {
              "text": "<system_note>
      Video file removed - your model lacks video input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should keep PDF files when model supports inputFile", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Read this document", type: "text" },
          {
            data: "data:pdf",
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputFile", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it("should replace PDF files when model does not support inputFile", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Read this document", type: "text" },
          {
            data: "data:pdf",
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Read this document",
              "type": "text",
            },
            {
              "text": "<system_note>
      File file removed - your model lacks file input capability.
      Convert it to a different format or request the user to provide it in a different format if you need to access it.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should handle various video mime types", async () => {
    const videoTypes = ["video/mp4", "video/webm", "video/ogg", "video/avi"];

    for (const mediaType of videoTypes) {
      const messages: ModelMessage[] = [
        {
          content: [
            {
              data: "base64data",
              mediaType,
              type: "file",
            },
          ],
          role: "user",
        },
      ];

      const model = createModel(["inputText", "outputText"]);
      const result = await filterUnsupportedMedia({ messages, model });

      expect(result).toMatchInlineSnapshot(`
        [
          {
            "content": [
              {
                "text": "<system_note>
        Video file removed - your model lacks video input capability.
        Convert it to a different format or request the user to provide it in a different format if you need to access it.
        </system_note>",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ]
      `);
    }
  });

  it("should allow PDF files for OpenAI models via OpenRouter", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Read this document", type: "text" },
          {
            data: "data:pdf",
            mediaType: "application/pdf",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createMockAIGatewayModel({
      author: "OpenAI",
      features: ["inputText", "inputFile", "outputText"],
      provider: "openrouter",
    });
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Read this document",
              "type": "text",
            },
            {
              "data": "data:pdf",
              "mediaType": "application/pdf",
              "type": "file",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("should keep image files for xAI models via OpenRouter", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Look at this", type: "text" },
          {
            data: "base64imagedata",
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const model = createMockAIGatewayModel({
      author: "x-ai",
      features: ["inputText", "inputImage", "inputFile", "outputText"],
      provider: "openrouter",
    });
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual(messages);
  });

  it.each([["media"], ["image-data"]] as const)(
    "should replace a %s image inside a tool result",
    async (type) => {
      // An image the agent read is media the user never attached, and a model
      // without image input chokes on it the same way. Providers that take
      // multipart tool results keep it right here, so this is the only pass
      // standing between the model and bytes it cannot read.
      const messages: ModelMessage[] = [
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  { text: "Image file: shot.png.", type: "text" },
                  { data: "base64data", mediaType: "image/png", type },
                ],
              },
              toolCallId: "call_1",
              toolName: "read_file",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ];

      const model = createModel(["inputText", "outputText"]);
      const result = await filterUnsupportedMedia({ messages, model });
      const part = Array.isArray(result[0]?.content)
        ? result[0].content[0]
        : undefined;
      const value =
        part && "output" in part && part.output.type === "content"
          ? part.output.value
          : [];

      expect(value).toMatchInlineSnapshot(`
        [
          {
            "text": "Image file: shot.png.",
            "type": "text",
          },
          {
            "text": "<system_note>
        Image file removed - your model lacks image input capability.
        Convert it to a different format or request the user to provide it in a different format if you need to access it.
        </system_note>",
            "type": "text",
          },
        ]
      `);
    },
  );
});
