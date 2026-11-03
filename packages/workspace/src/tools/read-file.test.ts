import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { type AIProviderType, APP_NAME_SLUG } from "@instrument-org/shared";
import { execa } from "execa";
import { cpSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FFMPEG_PATH } from "../lib/ffmpeg";
import { type RegionInput } from "../lib/image-preview";
import { measureImage } from "../lib/render-image";
import { grantFolder } from "../lib/chat/grants";
import { shellPath } from "../lib/workspace-fs-layout";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { pngHeaderBytes } from "../test/helpers/png-header";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";
import { ReadFile } from "./read-file";

// Every media input, so a read reaches the file handling under test rather
// than stopping at the model's capabilities.
const MEDIA_FEATURES = [
  "inputAudio",
  "inputFile",
  "inputImage",
  "inputText",
  "inputVideo",
  "outputText",
  "tools",
] satisfies AIGatewayModel.ModelFeatures[];

const model = createMockAIGatewayModel({ features: MEDIA_FEATURES });

// A copy, since the chat the tests read in keeps its store in its folder.
const root = mkdtempSync(path.join(os.tmpdir(), `${APP_NAME_SLUG}-read-file-`));
const fixturesPath = path.join(root, "file-system");
cpSync(
  path.join(import.meta.dirname, "../../fixtures/file-system"),
  fixturesPath,
  { recursive: true },
);

const chatId = createMockChatConfigForDir(fixturesPath, { model });

// A folder granted to the chat: another copy, outside the home folder, which a
// chat reaches too and which would own a path in the repository's fixtures
// first.
const testFolder = path.join(root, "Test Folder");
cpSync(fixturesPath, testFolder, { recursive: true });

type ReadInput = {
  filePath: string;
  limit?: number;
  offset?: number;
  region?: RegionInput;
};

const read = (input: ReadInput, readModel = model) =>
  runTool(TOOLS.ReadFile, {
    chatId,
    input: { explanation: "read", ...input },
    model: readModel,
    // Each call its own deadline: one built once would be a budget for the
    // whole file, and every test past it would fail on an aborted signal.
    signal: AbortSignal.timeout(30_000),
  });

const readValue = async (input: ReadInput, readModel = model) =>
  (await read(input, readModel))._unsafeUnwrap();

async function readImage(input: ReadInput, readModel = model) {
  const value = await readValue(input, readModel);
  if (value.state !== "image") {
    throw new Error(`Expected an image, got ${value.state}`);
  }
  return value;
}

async function readText(input: ReadInput) {
  const value = await readValue(input);
  if (value.state !== "exists") {
    throw new Error(`Expected text, got ${value.state}`);
  }
  return value;
}

/** Why a read was refused as an unsupported format, or the state it got instead. */
async function refusalReason(filePath: string) {
  const value = await readValue({ filePath });
  return value.state === "unsupported-format" ? value.reason : value.state;
}

/** Writes a file into the chat's folder and returns the path a read names it by. */
async function probe(name: string, data: Buffer | string) {
  await fs.writeFile(path.join(fixturesPath, name), data);
  return `./${name}`;
}

async function drawPng(name: string, size: string) {
  await execa(FFMPEG_PATH, [
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
    path.join(fixturesPath, name),
  ]);
  return `./${name}`;
}

async function encodeMp4(name: string) {
  const destination = path.join(fixturesPath, name);
  await execa(FFMPEG_PATH, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:duration=0.2:rate=10",
    "-pix_fmt",
    "yuv420p",
    destination,
  ]);
  return destination;
}

beforeAll(async () => {
  await grantFolder({ chatId, path: testFolder, source: "attached" });
});

afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("ReadFile", () => {
  it("lists a directory's entries instead of reading it", async () => {
    expect(await readValue({ filePath: "./a-folder" })).toMatchObject({
      entries: ["built-in.ts", "external-module.ts"],
      state: "is-directory",
    });
  });

  it("reads a file by its path relative to the chat's folder", async () => {
    const value = await readText({ filePath: "./grep-test.txt" });
    expect(value.content).toContain("async function testGrep");
    expect(value.filePath).toBe("./grep-test.txt");
  });

  it("reads the lines an offset and limit select", async () => {
    const value = await readText({
      filePath: "./grep-test.txt",
      limit: 3,
      offset: 3,
    });
    expect(value).toMatchObject({
      content:
        "It contains multiple lines with various patterns to test:\n- async functions\n- regular expressions",
      displayedLines: 3,
      hasMoreLines: true,
      offset: 3,
    });
  });

  it("reads a file in a granted folder by its full path", async () => {
    const value = await readText({
      filePath: path.join(testFolder, "grep-test.txt"),
    });
    expect(value.content).toContain("async function testGrep");
    expect(value.filePath).toBe(
      shellPath(path.join(testFolder, "grep-test.txt")),
    );
  });

  it("shows a file in the chat's folder named by its full path as relative", async () => {
    const value = await readText({
      filePath: path.join(fixturesPath, "grep-test.txt"),
    });
    expect(value.content).toContain("async function testGrep");
    expect(value.filePath).toBe("./grep-test.txt");
  });

  it("suggests a similarly named file when the one asked for is missing", async () => {
    const value = await readValue({ filePath: "./grep-test.ts" });
    expect(value.state).toBe("does-not-exist");
    expect(value.state === "does-not-exist" && value.suggestions).toContain(
      "grep-test.txt",
    );
  });

  it("finds a macOS screenshot named with U+202F before AM/PM when asked for with a plain space", async () => {
    await probe("Screenshot 2025-01-01 at 9.00 AM.png", "fake-png-data");
    expect(
      await readValue({ filePath: "./Screenshot 2025-01-01 at 9.00 AM.png" }),
    ).toMatchObject({ content: "fake-png-data", state: "exists" });
  });

  it("does not cut a character in half when truncating a long line", async () => {
    // A line over the cap whose 2000th code unit is the first half of an
    // emoji. Slicing at a fixed index leaves a surrogate with no partner,
    // which has no UTF-8 encoding and gets the whole request rejected -- on
    // content that is already saved and replayed on every later turn.
    const filePath = await probe(
      "long-line-probe.txt",
      `${"a".repeat(1999)}🙈${"b".repeat(50)}\n`,
    );
    const { content } = await readText({ filePath });
    expect(Buffer.from(content, "utf8").toString("utf8")).toStrictEqual(
      content,
    );
    expect(content).toContain(`${"a".repeat(1999)}...`);
  });

  it("tells the model which media it can read", async () => {
    const mediaLine = async (features: AIGatewayModel.ModelFeatures[]) => {
      const tool = await ReadFile.aiSDKTool({
        model: createMockAIGatewayModel({ features }),
        chatId,
      });
      const description =
        typeof tool.description === "string" ? tool.description : "";
      return description
        .split("\n")
        .find(
          (line) =>
            line.includes("cannot take") || line.includes("You can read"),
        );
    };

    expect({
      everyMedium: await mediaLine(MEDIA_FEATURES),
      noAudioOrVideo: await mediaLine(
        MEDIA_FEATURES.filter((f) => f !== "inputAudio" && f !== "inputVideo"),
      ),
      textOnly: await mediaLine(["inputText", "outputText", "tools"]),
    }).toMatchInlineSnapshot(`
      {
        "everyMedium": "- You can read images, PDFs, audio files, and video files by using this tool.",
        "noAudioOrVideo": "- You can read images and PDFs by using this tool. This model cannot take audio files or video files as input, in any format: get at what they hold with other tools instead, such as a transcript of audio or the extracted text of a PDF.",
        "textOnly": "- This model cannot take images, PDFs, audio files, or video files as input, in any format: get at what they hold with other tools instead, such as a transcript of audio or the extracted text of a PDF.",
      }
    `);
  });

  it("refuses audio to a model that cannot hear it, before size or format", async () => {
    // Over the audio cap on purpose: the size refusal suggests compressing,
    // which is wasted work when no size of the file reaches this model.
    const filePath = await probe(
      "deaf-model-probe.mp3",
      Buffer.alloc(11 * 1024 * 1024),
    );
    const result = await read(
      { filePath },
      createMockAIGatewayModel({
        features: MEDIA_FEATURES.filter((f) => f !== "inputAudio"),
      }),
    );

    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"This model cannot take audio input, so reading \`./deaf-model-probe.mp3\` would show it nothing, in this format or any other. To get at what is said in it, transcribe it to text (the \`local-ml\` skill does speech-to-text) and read the transcript."`,
    );
  });

  describe("images", () => {
    it.each([
      {
        expected: { height: 240, viewHeight: 240, viewWidth: 320, width: 320 },
        name: "in-budget",
        size: "320x240",
      },
      {
        // Over the preview budget, so the model is shown a smaller copy and
        // has to be told which of the two sizes its coordinates live in.
        expected: {
          height: 1200,
          viewHeight: 840,
          viewWidth: 1400,
          width: 2000,
        },
        name: "oversized",
        size: "2000x1200",
      },
    ])(
      "announces the file and view sizes of a $name image and sends bytes of exactly the view size",
      async ({ expected, name, size }) => {
        const value = await readImage({
          filePath: await drawPng(`dimension-probe-${name}.png`, size),
        });

        expect({
          height: value.height,
          viewHeight: value.viewHeight,
          viewWidth: value.viewWidth,
          width: value.width,
        }).toEqual(expected);
        // The contract the region read rests on, settled by measuring the
        // bytes in the result rather than comparing two numbers computed the
        // same way.
        expect(
          measureImage(Buffer.from(value.base64Data, "base64")),
        ).toMatchObject({
          height: value.viewHeight,
          mediaType: value.mimeType,
          width: value.viewWidth,
        });
      },
      60_000,
    );

    it("describes an image in the same pixel space whatever model is active", async () => {
      // A coordinate space derived from the active model would be redefined by
      // a model switch, silently invalidating every earlier message that
      // referred to it. Nothing here may vary with the model.
      const filePath = await drawPng("model-switch-probe.png", "2000x1200");
      const readWith = (provider: AIProviderType) =>
        readImage(
          { filePath },
          createMockAIGatewayModel({ features: MEDIA_FEATURES, provider }),
        );

      expect(await readWith("anthropic")).toEqual(await readWith("openai"));
    }, 60_000);

    it("reports the format the bytes are, not the one the name claims", async () => {
      await drawPng("mislabeled-source.png", "320x240");
      await fs.copyFile(
        path.join(fixturesPath, "mislabeled-source.png"),
        path.join(fixturesPath, "mislabeled.jpg"),
      );

      const value = await readImage({ filePath: "./mislabeled.jpg" });
      expect(value.mimeType).toBe("image/png");
    }, 60_000);

    it("refuses an image whose bytes cannot be decoded", async () => {
      // An interrupted download or a truncated write leaves a file that opens
      // as an image and is not one. Handing those bytes to the provider gets
      // the request rejected, and since the part is persisted the rejection
      // repeats on every later turn.
      const filePath = await probe(
        "not-really.png",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      );
      expect(await refusalReason(filePath)).toBe("undecodable-image");
    }, 60_000);

    it("refuses a truncated image that is small enough to pass through", async () => {
      // Dimensions come from the header, so a file cut short measures fine; an
      // image inside the preview budget is then passed through byte for byte
      // and never decoded by anything on the way out.
      await drawPng("damaged-source.png", "640x480");
      const bytes = await fs.readFile(
        path.join(fixturesPath, "damaged-source.png"),
      );
      expect(measureImage(bytes)).toMatchObject({ height: 480, width: 640 });
      const filePath = await probe(
        "damaged.png",
        bytes.subarray(0, Math.floor(bytes.byteLength * 0.3)),
      );

      expect(await refusalReason(filePath)).toBe("truncated-image");
    }, 60_000);

    it("refuses an image whose declared dimensions are too large to decode", async () => {
      // Bytes on disk say nothing about pixels in memory, so the size cap
      // never sees this coming. Refused from the header, before a decode --
      // and built as a header alone, so the test does not spend what the
      // guard refuses.
      const filePath = await probe(
        "decode-bomb.png",
        pngHeaderBytes({ height: 16_000, width: 16_000 }),
      );
      expect(await refusalReason(filePath)).toBe("image-too-large");
    }, 60_000);
  });

  describe("regions", () => {
    it("crops a region from the full-resolution file and magnifies it", async () => {
      const value = await readImage({
        filePath: await drawPng("region-probe.png", "3840x2160"),
        region: { x1: 100, x2: 500, y1: 100, y2: 400 },
      });

      // A 400x300 slice of the 1456x819 view is 1055x791 of the original,
      // handed back larger still so its contents cover more patches.
      expect({
        region: value.region,
        renderedHeight: value.renderedHeight,
        renderedWidth: value.renderedWidth,
      }).toMatchInlineSnapshot(`
        {
          "region": {
            "x1": 100,
            "x2": 500,
            "y1": 100,
            "y2": 400,
          },
          "renderedHeight": 952,
          "renderedWidth": 1270,
        }
      `);
    }, 60_000);

    it("clamps a region that runs off the edge of the image and says what was asked", async () => {
      const value = await readImage({
        filePath: await drawPng("region-clamp-probe.png", "320x240"),
        region: { x1: -50, x2: 9000, y1: 100, y2: 50 },
      });

      // Corners come back ordered and inside the image, beside the rectangle
      // that was asked for, which is a different area of the picture.
      expect(value.region).toEqual({ x1: 0, x2: 320, y1: 50, y2: 100 });
      expect(value.requestedRegion).toEqual({
        x1: -50,
        x2: 9000,
        y1: 50,
        y2: 100,
      });
    }, 60_000);

    it.each([
      // Elongated enough that the view's short edge rounds hard: a single
      // width-derived scale factor is then several percent wrong on the other
      // axis, and a region spanning that edge maps to one pixel past the
      // source and fails the render rather than landing on the edge.
      { name: "a wide image", size: "4001x37" },
      { name: "a tall image", size: "37x4001" },
    ])(
      "renders a region spanning the far edges of $name",
      async ({ size }) => {
        const filePath = await drawPng(`region-edge-${size}.png`, size);
        // Learn the view first, the way the tool tells the model to: a region
        // is expressed in the view's pixel space, not the file's.
        const { viewHeight = 0, viewWidth = 0 } = await readImage({
          filePath,
        });

        // Touches both far edges without covering the whole view, which is
        // read as no zoom at all and would never reach the mapping this
        // covers.
        const region = { x1: 1, x2: viewWidth, y1: 1, y2: viewHeight };
        const zoomed = await readImage({ filePath, region });
        expect(zoomed.region).toEqual(region);
      },
      60_000,
    );

    it("reports an empty region back to the model instead of failing", async () => {
      const result = await read({
        filePath: await drawPng("region-empty-probe.png", "320x240"),
        region: { x1: 400, x2: 500, y1: 10, y2: 20 },
      });

      expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
        `"Region (400,10)-(500,20) is empty or outside the 320x240 image. Give two corners in that pixel space, with the origin at the top-left."`,
      );
    }, 60_000);

    it("refuses a region too small to magnify into anything", async () => {
      const result = await read({
        filePath: await drawPng("region-tiny-probe.png", "320x240"),
        region: { x1: 100, x2: 101, y1: 100, y2: 101 },
      });

      // Answering this returns a flat expanse of interpolated color, which
      // reads as "the picture is blank" rather than as "you asked for one
      // pixel". The refusal has to name the size to be actionable.
      expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
        `"Region (100,100)-(101,101) covers 1x1 pixels of the source image, too few to magnify into anything readable. Give a rectangle covering at least 8x8 pixels, in the 320x240 space the image was shown to you in."`,
      );
    }, 60_000);

    it.each([
      {
        expected: "no-place",
        name: "the unit square",
        region: { x1: 0, x2: 1, y1: 0, y2: 1 },
      },
      {
        expected: "no-place",
        name: "a corner too small to hold a picture",
        region: { x1: 0, x2: 4, y1: 0, y2: 4 },
      },
      {
        // Cropping this would re-render the picture the model already has, as
        // a second full-budget image in the transcript.
        expected: "whole-image",
        name: "the whole image",
        region: { x1: 0, x2: 320, y1: 0, y2: 240 },
      },
    ])(
      "reads the whole image when the region is $name, and says the region did nothing",
      async ({ expected, region }) => {
        const value = await readImage({
          filePath: await drawPng("region-ignored-probe.png", "320x240"),
          region,
        });

        expect(value).toMatchObject({
          height: 240,
          regionIgnored: expected,
          requestedRegion: region,
          width: 320,
        });
        expect(value.region).toBeUndefined();
        expect(value.renderedWidth).toBeUndefined();
      },
      60_000,
    );

    it("reads a text file without comment when its region was filled in rather than aimed", async () => {
      // A model that fills the parameter in on every call reaches text files
      // too, and a note about a rectangle it did not mean is noise.
      const value = await readText({
        filePath: "./grep-test.txt",
        region: { x1: 0, x2: 0, y1: 0, y2: 0 },
      });
      expect(value).not.toHaveProperty("regionIgnored");
    });

    it("reads a text file whole when a region is aimed at it, and says so", async () => {
      const value = await readText({
        filePath: "./grep-test.txt",
        limit: 1,
        region: { x1: 0, x2: 1000, y1: 0, y2: 1000 },
      });

      expect(
        ReadFile.toModelOutput({
          input: { explanation: "zoom", filePath: "./grep-test.txt" },
          output: value,
          toolCallId: "123",
        }),
      ).toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "<path>./grep-test.txt</path>
        <content lines="lines 1-1 (total 30 lines)">
           1→This is a test file for grep functionality.
        ... 29 lines not shown ...

        (Use offset parameter to read beyond line 2)
        </content>
        <instrument-system-note>
        region only applies to images, and \`./grep-test.txt\` is not one, so it was ignored and the file read as text. Leave region out when reading anything but an image.
        </instrument-system-note>",
        }
      `);
    });
  });

  describe("PDFs, audio and video", () => {
    it("refuses a PDF that stops before its end marker", async () => {
      // A PDF goes out as media with nothing but a size cap in front of it, so
      // a truncated one bricks a session exactly the way a truncated image did.
      const filePath = await probe(
        "truncated.pdf",
        "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n",
      );
      expect(await refusalReason(filePath)).toBe("undecodable-pdf");
    });

    it("reads a video ffprobe can decode", async () => {
      await encodeMp4("bars.mp4");
      expect(await refusalReason("./bars.mp4")).toBe("video");
    }, 60_000);

    it("refuses a video whose bytes cannot be decoded", async () => {
      // Half of a real download. MP4 keeps its index at the end of the file,
      // so the half that arrived is undecodable rather than merely short.
      const whole = await fs.readFile(await encodeMp4("whole.mp4"));
      const filePath = await probe(
        "not-really.mp4",
        whole.subarray(0, whole.byteLength / 2),
      );
      expect(await refusalReason(filePath)).toBe("undecodable-media");
    }, 60_000);
  });
});

describe("toModelOutput", () => {
  const textOutput = (
    output: Partial<{
      content: string;
      displayedLines: number;
      hasMoreLines: boolean;
      offset: number;
      totalLines: number;
      truncatedByBytes: boolean;
    }>,
  ) =>
    ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./foo.ts" },
      output: {
        content: "const x = 1;\nconst y = 2;",
        displayedLines: 2,
        filePath: "./foo.ts",
        hasMoreLines: false,
        modifiedAt: 0,
        offset: 1,
        state: "exists",
        totalLines: 2,
        truncatedByBytes: false,
        ...output,
      },
      toolCallId: "123",
    });

  it("numbers the lines of a whole file", () => {
    expect(textOutput({})).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "<path>./foo.ts</path>
      <content>
         1→const x = 1;
         2→const y = 2;
      </content>",
      }
    `);
  });

  it("counts the lines hidden before and after a partial read", () => {
    expect(
      textOutput({
        content: "line5\nline6\nline7",
        displayedLines: 3,
        hasMoreLines: true,
        offset: 5,
        totalLines: 20,
      }),
    ).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "<path>./foo.ts</path>
      <content lines="lines 5-7 (total 20 lines)">
      ... 4 lines not shown ...
         5→line5
         6→line6
         7→line7
      ... 13 lines not shown ...

      (Use offset parameter to read beyond line 8)
      </content>",
      }
    `);
  });

  it("says when the byte cap cut a read short", () => {
    expect(
      textOutput({
        content: "line1\nline2",
        hasMoreLines: true,
        totalLines: 500,
        truncatedByBytes: true,
      }),
    ).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "<path>./foo.ts</path>
      <content lines="lines 1-2 (total 500 lines)">
         1→line1
         2→line2
      ... 498 lines not shown (output capped at 50KB) ...

      (Use offset parameter to read beyond line 2)
      </content>",
      }
    `);
  });

  it("reports an empty file as a note instead of a blank numbered line", () => {
    expect(textOutput({ content: "", displayedLines: 1, totalLines: 1 }))
      .toMatchInlineSnapshot(`
        {
          "type": "text",
          "value": "<instrument-system-note>
        File \`./foo.ts\` exists but is empty.
        </instrument-system-note>",
        }
      `);
  });

  it("lists the suggestions for a missing file, and only when there are some", () => {
    const missing = (suggestions: string[]) =>
      ReadFile.toModelOutput({
        input: { explanation: "read", filePath: "./missing.ts" },
        output: {
          filePath: "./missing.ts",
          state: "does-not-exist",
          suggestions,
        },
        toolCallId: "123",
      });

    expect({
      none: missing([]),
      some: missing(["./missing.txt", "./missing.tsx"]),
    }).toMatchInlineSnapshot(`
      {
        "none": {
          "type": "error-text",
          "value": "File \`./missing.ts\` does not exist",
        },
        "some": {
          "type": "error-text",
          "value": "File \`./missing.ts\` does not exist

      Did you mean one of these?
      ./missing.txt
      ./missing.tsx",
        },
      }
    `);
  });

  // The refusals look alike and call for opposite responses, and getting that
  // wrong is expensive: a message inviting a conversion on data that is not
  // there sent a model on an unbounded errand. Separate tests rather than a
  // table, so each message stays visible as an inline snapshot.
  function unsupportedFormatMessage(
    reason:
      | "binary-file"
      | "truncated-image"
      | "undecodable-image"
      | "undecodable-media"
      | "unsupported-image-format",
    mimeType: string | undefined,
  ) {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./photo.png" },
      output: {
        filePath: "./photo.png",
        mimeType,
        modifiedAt: 0,
        reason,
        state: "unsupported-format",
      },
      toolCallId: "call-1",
    });
    expect(result.type).toBe("error-text");
    return result.type === "error-text" ? result.value : "";
  }

  it("tells a damaged image to stop rather than convert", () => {
    expect(
      unsupportedFormatMessage("truncated-image", "image/png"),
    ).toMatchInlineSnapshot(
      `"./photo.png is a truncated image: it declares its format and size, then ends before its data does. The missing bytes cannot be reconstructed by any tool. This format stores its pixels as a single compressed stream, so a partial copy decodes to nothing -- converting it, or opening it with ffmpeg or Python, cannot change that. Do not make more than that one attempt, and do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("tells a truncated JPEG the part that arrived is still worth one look", () => {
    // Verified against ffmpeg: a JPEG cut to 40% still renders its top portion,
    // while a PNG cut the same way decodes to nothing.
    expect(
      unsupportedFormatMessage("truncated-image", "image/jpeg"),
    ).toMatchInlineSnapshot(
      `"./photo.png is a truncated image: it declares its format and size, then ends before its data does. The missing bytes cannot be reconstructed by any tool. A JPEG decodes top to bottom, so the part that did arrive is still renderable: if what you need is near the top, one attempt at decoding it is worth making. Do not make more than that one attempt, and do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("bounds the audio and video message it cannot split", () => {
    // ffprobe refusing to parse a container means either a short download or
    // the wrong format, and nothing cheap separates them. So the message keeps
    // the one useful step and bounds it.
    expect(
      unsupportedFormatMessage("undecodable-media", "video/mp4"),
    ).toMatchInlineSnapshot(
      `"Cannot decode \`./photo.png\` (video/mp4): it is either incomplete or not the format its name claims. Identify it once with \`ffprobe -v error -show_format -show_streams -of json './photo.png'\`. If that names a format, converting it is worth one attempt; if it reports a truncated or unknown stream, the data is missing and no conversion will recover it. Either way, do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("tells an unrecognized image to identify itself once", () => {
    expect(
      unsupportedFormatMessage("undecodable-image", "image/png"),
    ).toMatchInlineSnapshot(
      `"Cannot read \`./photo.png\` as an image: nothing identifies these bytes as one. It may be a different format under an image's name, or not an image at all. Identify it once with \`ffprobe -v error -show_format -show_streams -of json './photo.png'\` or \`file\`. If it is a format that converts, convert it and read the result; if it is not, say so rather than reading this file again."`,
    );
  });

  it("names the supported formats for an image in another one, and the MIME type of a binary file when known", () => {
    expect({
      binary: unsupportedFormatMessage("binary-file", "application/zip"),
      binaryUnknown: unsupportedFormatMessage("binary-file", undefined),
      imageFormat: unsupportedFormatMessage(
        "unsupported-image-format",
        "image/bmp",
      ),
    }).toMatchInlineSnapshot(`
      {
        "binary": "Cannot read binary file (application/zip): \`./photo.png\`. Consider using command-line tools or scripts to extract or convert the file contents if needed.",
        "binaryUnknown": "Cannot read binary file with unknown MIME type: \`./photo.png\`. Consider using command-line tools or scripts to extract or convert the file contents if needed.",
        "imageFormat": "Unsupported image format: \`./photo.png\` (image/bmp). Input should be 'image/jpeg', 'image/png', 'image/webp'. Please convert the image to a supported format before reading.",
      }
    `);
  });

  it.each([
    { label: "PDF", mimeType: "application/pdf", state: "pdf" },
    { label: "Audio", mimeType: "audio/mpeg", state: "audio" },
    { label: "Video", mimeType: "video/mp4", state: "video" },
  ] as const)(
    "sends a $state file as a labeled media part",
    ({ label, mimeType, state }) => {
      expect(
        ReadFile.toModelOutput({
          input: { explanation: "read", filePath: "./f" },
          output: {
            base64Data: "abc123",
            filePath: "./f",
            mimeType,
            modifiedAt: 0,
            state,
          },
          toolCallId: "123",
        }),
      ).toEqual({
        type: "content",
        value: [
          { text: `${label} file: \`./f\`.`, type: "text" },
          {
            data: { data: "abc123", type: "data" },
            mediaType: mimeType,
            type: "file",
          },
        ],
      });
    },
  );

  const imageText = (
    output: Partial<{
      height: number;
      region: RegionInput;
      regionIgnored: "no-place" | "whole-image";
      renderedHeight: number;
      renderedWidth: number;
      requestedRegion: RegionInput;
      viewHeight: number;
      viewWidth: number;
      width: number;
    }>,
  ) => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./scan.png" },
      output: {
        base64Data: "abc123",
        filePath: "./scan.png",
        height: 2160,
        mimeType: "image/png",
        modifiedAt: 0,
        state: "image",
        viewHeight: 819,
        viewWidth: 1456,
        width: 3840,
        ...output,
      },
      toolCallId: "123",
    });
    return result.type === "content" && result.value[0];
  };

  it("states one size when the model sees the image at full resolution", () => {
    expect(
      imageText({ height: 240, viewHeight: 240, viewWidth: 320, width: 320 }),
    ).toMatchInlineSnapshot(`
      {
        "text": "Image file: \`./scan.png\` (320x240 px).",
        "type": "text",
      }
    `);
  });

  it("states both sizes when the model is shown a downscaled copy", () => {
    expect(imageText({})).toMatchInlineSnapshot(`
      {
        "text": "Image file: \`./scan.png\` (shown to you at 1456x819 px; the file on disk is 3840x2160). Small text and closely spaced lines may not survive at that size; read it again with a \`region\` to magnify part of it. A region's corners are pixels in that 1456x819 space, not in the file's larger one.",
        "type": "text",
      }
    `);
  });

  it("says which rectangle a region read was taken to mean", () => {
    expect(
      imageText({
        region: { x1: 100, x2: 500, y1: 100, y2: 400 },
        renderedHeight: 952,
        renderedWidth: 1270,
      }),
    ).toMatchInlineSnapshot(`
      {
        "text": "Image file: \`./scan.png\` -- region (100,100)-(500,400) of the 1456x819 view, cropped from the 3840x2160 original and magnified to 1270x952.",
        "type": "text",
      }
    `);
  });

  it("leads with the correction when a region was trimmed to fit", () => {
    // Asked for the left half in the file's pixel space, handed the full
    // width. Without the second sentence the first reads as a confirmation.
    expect(
      imageText({
        height: 2530,
        region: { x1: 0, x2: 1176, y1: 0, y2: 630 },
        renderedHeight: 810,
        renderedWidth: 1512,
        requestedRegion: { x1: 0, x2: 1440, y1: 0, y2: 630 },
        viewHeight: 1033,
        viewWidth: 1176,
        width: 2880,
      }),
    ).toMatchInlineSnapshot(`
      {
        "text": "Image file: \`./scan.png\` -- region (0,0)-(1176,630) of the 1176x1033 view, cropped from the 2880x2530 original and magnified to 1512x810. This is not the rectangle you asked for: (0,0)-(1440,630) runs outside the 1176x1033 space the image was shown to you in, so it was trimmed to fit.",
        "type": "text",
      }
    `);
  });

  it("says the whole image is back when the region named no place or covered all of it", () => {
    // Degrading silently leaves the model no way to tell the rectangle did
    // nothing, and the ones measured in the wild went on to ask for the whole
    // image as a rectangle instead.
    expect({
      noPlace: imageText({
        regionIgnored: "no-place",
        requestedRegion: { x1: 0, x2: 1, y1: 0, y2: 1 },
      }),
      wholeImage: imageText({
        regionIgnored: "whole-image",
        requestedRegion: { x1: 0, x2: 1456, y1: 0, y2: 819 },
      }),
    }).toMatchInlineSnapshot(`
      {
        "noPlace": {
          "text": "Image file: \`./scan.png\` (shown to you at 1456x819 px; the file on disk is 3840x2160) -- the region (0,0)-(1,1) you asked for is too small to be a place on the image. This is the whole image; to magnify part of it, give a smaller rectangle in that 1456x819 space.",
          "type": "text",
        },
        "wholeImage": {
          "text": "Image file: \`./scan.png\` (shown to you at 1456x819 px; the file on disk is 3840x2160) -- the region (0,0)-(1456,819) you asked for covers the whole image, so there is nothing in it to magnify. This is the whole image; to magnify part of it, give a smaller rectangle in that 1456x819 space.",
          "type": "text",
        },
      }
    `);
  });
});
