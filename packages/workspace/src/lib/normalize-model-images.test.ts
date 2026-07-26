import type { ModelMessage } from "ai";

import { execa } from "execa";
import { beforeAll, describe, expect, it } from "vitest";

import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { FFMPEG_PATH } from "./ffmpeg";
import { normalizeModelImages } from "./normalize-model-images";
import { measureImage } from "./render-image";

async function drawPng(size: string) {
  const result = await execa(
    FFMPEG_PATH,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${size}:duration=1:rate=1`,
      "-frames:v",
      "1",
      "-f",
      "image2",
      "-c:v",
      "png",
      "pipe:1",
    ],
    { encoding: "buffer" },
  );
  return Buffer.from(result.stdout);
}

const model = createMockAIGatewayModel({
  features: ["inputText", "inputImage", "outputText"],
});

/** Well past the 1568-edge/1568-patch floor every provider starts at. */
let oversized: string;
/** Comfortably inside it. */
let small: string;

beforeAll(async () => {
  oversized = (await drawPng("3840x2160")).toString("base64");
  small = (await drawPng("320x240")).toString("base64");
}, 60_000);

function imageDataOf(message: ModelMessage | undefined) {
  if (!message || !Array.isArray(message.content)) {
    return undefined;
  }
  const part = message.content.find((item) => item.type === "file");
  return part && "data" in part && typeof part.data === "string"
    ? part.data
    : undefined;
}

describe("normalizeModelImages", () => {
  it("leaves an in-budget image byte-for-byte alone", async () => {
    const messages: ModelMessage[] = [
      {
        content: [{ data: small, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages, model });

    expect(imageDataOf(result)).toBe(small);
  }, 60_000);

  it("resizes an oversized upload to the size the model renders", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "look at this", type: "text" },
          { data: oversized, mediaType: "image/png", type: "file" },
        ],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages, model });
    const data = imageDataOf(result);

    expect(data).not.toBe(oversized);
    expect(measureImage(Buffer.from(data ?? "", "base64")))
      .toMatchInlineSnapshot(`
        {
          "height": 819,
          "width": 1456,
        }
      `);
  }, 60_000);

  it("keeps a data URL a data URL", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            data: `data:image/png;base64,${oversized}`,
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages, model });

    expect(imageDataOf(result)?.startsWith("data:image/png;base64,")).toBe(
      true,
    );
  }, 60_000);

  it("resizes an image inside a tool result", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                { text: "Image file: work/shot.png.", type: "text" },
                { data: oversized, mediaType: "image/png", type: "media" },
              ],
            },
            toolCallId: "call-1",
            toolName: "read_file",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ];

    const [result] = await normalizeModelImages({ messages, model });
    const part =
      result && Array.isArray(result.content) ? result.content[0] : undefined;
    const value =
      part && "output" in part && part.output.type === "content"
        ? part.output.value
        : [];
    const media = value.find((item) => item.type === "media");

    expect(value[0]).toEqual({
      text: "Image file: work/shot.png.",
      type: "text",
    });
    expect(media && "data" in media ? media.data : undefined).not.toBe(
      oversized,
    );
    expect(
      measureImage(
        Buffer.from(
          media && "data" in media && typeof media.data === "string"
            ? media.data
            : "",
          "base64",
        ),
      ),
    ).toEqual({ height: 819, width: 1456 });
  }, 60_000);

  it("passes through a URL it holds no bytes for", async () => {
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

    const [result] = await normalizeModelImages({ messages, model });

    expect(result).toEqual(messages[0]);
  }, 60_000);

  it("leaves non-image files and text alone", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "hi", type: "text" },
          { data: "cGRmLWJ5dGVz", mediaType: "application/pdf", type: "file" },
        ],
        role: "user",
      },
      { content: "system prompt", role: "system" },
    ];

    const result = await normalizeModelImages({ messages, model });

    expect(result).toEqual(messages);
  }, 60_000);

  it("reuses the cached render instead of re-encoding an unchanged history", async () => {
    const messages: ModelMessage[] = [
      {
        content: [{ data: oversized, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    const first = await normalizeModelImages({ messages, model });
    const second = await normalizeModelImages({ messages, model });

    // Byte-identical across turns, or the prompt cache breaks on every request.
    expect(imageDataOf(second[0])).toBe(imageDataOf(first[0]));
  }, 60_000);
});
