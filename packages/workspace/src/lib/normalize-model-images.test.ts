import type { ModelMessage } from "ai";

import { execa } from "execa";
import { beforeAll, describe, expect, it } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";
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

/** Well past the fixed preview budget. */
let oversized: string;
/** Comfortably inside it. */
let small: string;

beforeAll(async () => {
  const [big, tiny] = await Promise.all([
    drawPng("3840x2160"),
    drawPng("320x240"),
  ]);
  oversized = big.toString("base64");
  small = tiny.toString("base64");
}, 60_000);

function imageDataOf(message: ModelMessage | undefined) {
  if (!message || !Array.isArray(message.content)) {
    return;
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

    const [result] = await normalizeModelImages({ messages });

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

    const [result] = await normalizeModelImages({ messages });
    const data = imageDataOf(result);

    expect(data).not.toBe(oversized);
    expect(measureImage(Buffer.from(data ?? "", "base64")))
      .toMatchInlineSnapshot(`
        {
          "format": "png",
          "height": 819,
          "mediaType": "image/png",
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

    const [result] = await normalizeModelImages({ messages });

    expect(imageDataOf(result)?.startsWith("data:image/png;base64,")).toBe(
      true,
    );
  }, 60_000);

  it.each([["media"], ["image-data"]] as const)(
    "resizes an image inside a %s tool result",
    async (type) => {
      const messages: ModelMessage[] = [
        {
          content: [
            {
              output: {
                type: "content",
                value: [
                  { text: "Image file: work/shot.png.", type: "text" },
                  { data: oversized, mediaType: "image/png", type },
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

      const [result] = await normalizeModelImages({ messages });
      const part =
        result && Array.isArray(result.content) ? result.content[0] : undefined;
      const value =
        part && "output" in part && part.output.type === "content"
          ? part.output.value
          : [];
      const media = value.find((item) => item.type === type);

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
      ).toEqual({
        format: "png",
        height: 819,
        mediaType: "image/png",
        width: 1456,
      });
    },
    60_000,
  );

  it.each([
    {
      data: Buffer.from("<html>404 not found</html>").toString("base64"),
      name: "an error page saved with an image name",
    },
    {
      // cspell:ignore AAAANS -- a base64 PNG header, not prose
      data: Buffer.from("iVBORw0KGgoAAAANSUhEUg", "base64").toString("base64"),
      name: "a truncated write",
    },
  ])(
    "drops $name rather than sending it",
    async ({ data }) => {
      // These get rejected by the provider, and the rejection is permanent: the
      // part is already on disk and replays on every later turn, so one bad read
      // would otherwise end the conversation.
      const messages: ModelMessage[] = [
        {
          content: [{ data, mediaType: "image/png", type: "file" }],
          role: "user",
        },
      ];

      const [result] = await normalizeModelImages({ messages });
      const part = Array.isArray(result?.content)
        ? result.content[0]
        : undefined;

      expect(part?.type).toBe("text");
      expect(part && "text" in part ? part.text : "").toContain(
        "[Image omitted:",
      );
    },
    60_000,
  );

  it("drops an image declaring more pixels than a decoder should hold", async () => {
    // `read_file` refuses these up front, so anything reaching here came from a
    // user upload, a generated image, or a session recorded before that check.
    // Says why rather than reusing the generic note, since the fix is different:
    // downscale and re-attach, not "the file is broken".
    const messages: ModelMessage[] = [
      {
        content: [
          {
            data: pngHeaderBytes({ height: 16_000, width: 16_000 }).toString(
              "base64",
            ),
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages });
    const part = Array.isArray(result?.content) ? result.content[0] : undefined;

    expect(part?.type).toBe("text");
    expect(part && "text" in part ? part.text : "").toContain(
      "too large to decode",
    );
  });

  it("resizes an image part that declares no media type", async () => {
    // An image part may omit its type, and the bytes are enough to work from,
    // so this is the one media shape that would otherwise reach the provider
    // unmeasured and unresized.
    const messages: ModelMessage[] = [
      { content: [{ image: oversized, type: "image" }], role: "user" },
    ];

    const [result] = await normalizeModelImages({ messages });
    const part = Array.isArray(result?.content) ? result.content[0] : undefined;
    const data = part && "image" in part ? part.image : undefined;

    expect(part && "mediaType" in part ? part.mediaType : undefined).toBe(
      "image/png",
    );
    expect(
      measureImage(Buffer.from(typeof data === "string" ? data : "", "base64")),
    ).toEqual({
      format: "png",
      height: 819,
      mediaType: "image/png",
      width: 1456,
    });
  }, 60_000);

  it("drops an image part whose bytes are not an image", async () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            image: Buffer.from("<html>404 not found</html>").toString("base64"),
            type: "image",
          },
        ],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages });
    const part = Array.isArray(result?.content) ? result.content[0] : undefined;

    expect(part?.type).toBe("text");
    expect(part && "text" in part ? part.text : "").toContain(
      "[Image omitted:",
    );
  }, 60_000);

  it("corrects a media type the bytes contradict", async () => {
    // A download served as PNG under a `.jpg` name is the ordinary way this
    // happens, and the mismatch alone is enough to get the request rejected.
    const messages: ModelMessage[] = [
      {
        content: [{ data: small, mediaType: "image/jpeg", type: "file" }],
        role: "user",
      },
    ];

    const [result] = await normalizeModelImages({ messages });
    const part = Array.isArray(result?.content) ? result.content[0] : undefined;

    expect(part && "mediaType" in part ? part.mediaType : undefined).toBe(
      "image/png",
    );
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

    const [result] = await normalizeModelImages({ messages });

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

    const result = await normalizeModelImages({ messages });

    expect(result).toEqual(messages);
  }, 60_000);

  it("reuses the cached render instead of re-encoding an unchanged history", async () => {
    const messages: ModelMessage[] = [
      {
        content: [{ data: oversized, mediaType: "image/png", type: "file" }],
        role: "user",
      },
    ];

    const first = await normalizeModelImages({ messages });
    const second = await normalizeModelImages({ messages });

    // Byte-identical across turns, or the prompt cache breaks on every request.
    expect(imageDataOf(second[0])).toBe(imageDataOf(first[0]));
  }, 60_000);
});
