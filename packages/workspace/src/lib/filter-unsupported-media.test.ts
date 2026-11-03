import type { AIGatewayModel } from "@instrument-org/ai-gateway";
import type { ModelMessage } from "ai";

import { describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { filterUnsupportedMedia } from "./filter-unsupported-media";

const createModel = (
  features: AIGatewayModel.ModelFeatures[],
): AIGatewayModel.Type => createMockAIGatewayModel({ features });

/** One user message: a line of text and one file of `mediaType`. */
const withFile = (mediaType: string): ModelMessage[] => [
  {
    content: [
      { text: "Have a look", type: "text" },
      { data: "base64data", mediaType, type: "file" },
    ],
    role: "user",
  },
];

/** Each kind of media, the feature that lets it through, and how its note names it. */
const MEDIA = [
  ["audio/mp3", "inputAudio", "Audio file removed - your model lacks audio"],
  ["audio/wav", "inputAudio", "Audio file removed - your model lacks audio"],
  ["image/png", "inputImage", "Image file removed - your model lacks image"],
  ["image/webp", "inputImage", "Image file removed - your model lacks image"],
  ["video/mp4", "inputVideo", "Video file removed - your model lacks video"],
  ["video/webm", "inputVideo", "Video file removed - your model lacks video"],
  ["application/pdf", "inputFile", "File file removed - your model lacks file"],
] as const;

describe("filterUnsupportedMedia", () => {
  it("passes through messages without file parts", async () => {
    const messages: ModelMessage[] = [
      { content: "System message", role: "system" },
      { content: "Hello", role: "user" },
      { content: [{ text: "Hi there", type: "text" }], role: "assistant" },
    ];

    const model = createModel(["inputText", "outputText"]);
    expect(await filterUnsupportedMedia({ messages, model })).toEqual(messages);
  });

  it.each(MEDIA)("keeps %s for a model with %s", async (mediaType, feature) => {
    const messages = withFile(mediaType);
    const model = createModel(["inputText", feature, "outputText"]);
    expect(await filterUnsupportedMedia({ messages, model })).toEqual(messages);
  });

  it.each(MEDIA)(
    "replaces %s for a model without %s, keeping the text beside it",
    async (mediaType, _feature, note) => {
      const model = createModel(["inputText", "outputText"]);
      const result = await filterUnsupportedMedia({
        messages: withFile(mediaType),
        model,
      });
      expect(result).toEqual([
        {
          content: [
            { text: "Have a look", type: "text" },
            { text: expect.stringContaining(note), type: "text" },
          ],
          role: "user",
        },
      ]);
    },
  );

  it("says why the media is gone and what to do instead", async () => {
    const model = createModel(["inputText", "outputText"]);
    const result = await filterUnsupportedMedia({
      messages: withFile("image/png"),
      model,
    });

    expect(result).toMatchInlineSnapshot(`
      [
        {
          "content": [
            {
              "text": "Have a look",
              "type": "text",
            },
            {
              "text": "<system_note>
      Image file removed - your model lacks image input capability.
      No format of it will reach this model, so converting it will not help. If you need what it holds, get at that another way (a transcript of audio, the extracted text of a PDF), or ask the user for it as text.
      </system_note>",
              "type": "text",
            },
          ],
          "role": "user",
        },
      ]
    `);
  });

  it("filters each file in a message by its own kind", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { data: "base64imagedata", mediaType: "image/png", type: "file" },
          { data: "data:base64-audio", mediaType: "audio/mp3", type: "file" },
        ],
        role: "user",
      },
    ];

    const model = createModel(["inputText", "inputImage", "outputText"]);
    const result = await filterUnsupportedMedia({ messages, model });

    expect(result).toEqual([
      {
        content: [
          { data: "base64imagedata", mediaType: "image/png", type: "file" },
          {
            text: expect.stringContaining(
              "Audio file removed - your model lacks audio",
            ),
            type: "text",
          },
        ],
        role: "user",
      },
    ]);
  });

  it("does not filter file types outside every media category", async () => {
    const messages = withFile("application/zip");
    const model = createModel(["inputText", "outputText"]);
    expect(await filterUnsupportedMedia({ messages, model })).toEqual(messages);
  });

  it.each([["file-data"], ["image-data"]] as const)(
    "replaces a %s image inside a tool result",
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

      expect(value).toEqual([
        { text: "Image file: shot.png.", type: "text" },
        {
          text: expect.stringContaining(
            "Image file removed - your model lacks image",
          ),
          type: "text",
        },
      ]);
    },
  );
});
