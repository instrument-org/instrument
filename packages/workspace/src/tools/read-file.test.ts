import { type AIProviderType, APP_NAME_SLUG } from "@instrument-org/shared";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FFMPEG_PATH } from "../lib/ffmpeg";
import { measureImage } from "../lib/render-image";
import { FolderAttachment } from "../schemas/folder-attachment";
import { TaskDirSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { pngHeaderBytes } from "../test/helpers/png-header";
import { runTool } from "../test/helpers/run-tool";
import { TOOLS } from "./all";
import { ReadFile } from "./read-file";

const model = createMockAIGatewayModel();

// Mirrors `MEDIA_CONFIG.image.maxSize`, to show the byte cap is not what catches
// a decode bomb.
const MEDIA_CONFIG_IMAGE_MAX_SIZE = 50 * 1024 * 1024;

async function drawPngFixture(destination: string, size: string) {
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
    destination,
  ]);
}

const fixturesPath = path.join(
  import.meta.dirname,
  "../../fixtures/file-system",
);

const taskId = createMockTaskConfigForDir(fixturesPath, { model });

const attachedFolders: Record<string, FolderAttachment.Type> = {
  "test-folder": {
    createdAt: Date.now(),
    id: FolderAttachment.IdSchema.parse("test-folder-id"),
    name: "Test Folder",
    path: TaskDirSchema.parse(fixturesPath),
    source: "user",
  },
};

/* eslint-disable unicorn/no-await-expression-member */
describe("ReadFile", () => {
  describe("main agent", () => {
    const baseInput = {
      agentName: "main" as const,
      model,
      // A getter, so spreading this gives each call its own deadline. Built once
      // it would be a budget for the whole file rather than for one tool call,
      // and every test past the deadline would fail on an aborted signal for
      // reasons that have nothing to do with what it asserts.
      get signal() {
        return AbortSignal.timeout(30_000);
      },
      spawnAgent: vi.fn(),
      taskId,
      taskState: {},
    };

    it("should list files when given a directory path", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: { explanation: "read", filePath: "./a-folder" },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("is-directory");
      if (value.state === "exists") {
        expect(value.content).toMatchInlineSnapshot(`
          "built-in.ts
          external-module.ts"
        `);
      }
    });

    it("should read a file by relative path", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: { explanation: "read", filePath: "./grep-test.txt" },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("exists");
      if (value.state === "exists") {
        expect(value.content).toContain("async function testGrep");
        expect(value.filePath).toBe("./grep-test.txt");
      }
    });

    it("collapses the task dir a script wrote into a file, leaving home paths as data", async () => {
      // A script that resolved an absolute path can write the task dir into a
      // deliverable; reading it back must not leak the task layout. An unrelated
      // home path stays untouched -- redacting it risks mangling a legitimately
      // absolute path the agent then edits.
      const home = os.homedir();
      const probePath = path.join(fixturesPath, "redact-probe.txt");
      await fs.writeFile(
        probePath,
        `Attachments: ${fixturesPath}/attachments\nUnrelated: ${home}/elsewhere\n`,
      );

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./redact-probe.txt" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("exists");
        if (value.state === "exists") {
          expect(value.content).toContain("Attachments: ./attachments");
          expect(value.content).not.toContain(fixturesPath);
          expect(value.content).toContain(`Unrelated: ${home}/elsewhere`);
        }
      } finally {
        await fs.rm(probePath, { force: true });
      }
    });

    it.each([
      {
        expected: {
          height: 240,
          viewHeight: 240,
          viewWidth: 320,
          width: 320,
        },
        name: "in-budget",
        size: "320x240",
      },
      {
        // Over the provider floor, so the model is shown a smaller copy and
        // has to be told which of the two sizes its coordinates live in.
        expected: {
          height: 2160,
          viewHeight: 819,
          viewWidth: 1456,
          width: 3840,
        },
        name: "oversized",
        size: "3840x2160",
      },
    ])(
      "reports the file and view dimensions of a $name image",
      async ({ expected, size }) => {
        const imagePath = path.join(
          fixturesPath,
          `dimension-probe-${size}.png`,
        );
        await drawPngFixture(imagePath, size);

        try {
          const value = (
            await runTool(TOOLS.ReadFile, {
              ...baseInput,
              input: {
                explanation: "read",
                filePath: `./dimension-probe-${size}.png`,
              },
            })
          )._unsafeUnwrap();

          expect(value.state).toBe("image");
          if (value.state === "image") {
            expect({
              height: value.height,
              viewHeight: value.viewHeight,
              viewWidth: value.viewWidth,
              width: value.width,
            }).toEqual(expected);
          }
        } finally {
          await fs.rm(imagePath, { force: true });
        }
      },
      60_000,
    );

    it.each([
      // The passthrough branch and the render branch. The third way the two used
      // to disagree -- a render shrinking below its own target to fit the byte
      // cap -- is covered where it happens, in `renderImage`.
      { name: "in-budget", size: "320x240" },
      // Over the preview budget, so it renders, but far cheaper to render than a
      // 4K frame. These tests pay that cost now that read_file previews its own
      // bytes rather than leaving the resize to send time.
      { name: "oversized", size: "2000x1200" },
    ])(
      "sends bytes measuring exactly the view it announces for a $name image",
      async ({ size }) => {
        // The contract the region read rests on, checked the only way that
        // settles it: measure the bytes in the result rather than compare two
        // numbers computed the same way.
        const name = `announce-probe-${size}.png`;
        const imagePath = path.join(fixturesPath, name);
        await drawPngFixture(imagePath, size);

        try {
          const value = (
            await runTool(TOOLS.ReadFile, {
              ...baseInput,
              input: { explanation: "read", filePath: `./${name}` },
            })
          )._unsafeUnwrap();

          expect(value.state).toBe("image");
          if (value.state !== "image") {
            return;
          }

          const measured = measureImage(
            Buffer.from(value.base64Data, "base64"),
          );
          expect(measured).toMatchObject({
            height: value.viewHeight,
            width: value.viewWidth,
          });
          expect(measured?.mediaType).toBe(value.mimeType);
        } finally {
          await fs.rm(imagePath, { force: true });
        }
      },
      60_000,
    );

    it("describes an image in the same pixel space whatever model is active", async () => {
      // A coordinate space derived from the active model would be redefined by a
      // model switch, silently invalidating every earlier message that referred
      // to it. Nothing here may vary with the model.
      const imagePath = path.join(fixturesPath, "model-switch-probe.png");
      await drawPngFixture(imagePath, "2000x1200");

      try {
        const read = async (provider: AIProviderType) =>
          (
            await runTool(TOOLS.ReadFile, {
              ...baseInput,
              input: {
                explanation: "read",
                filePath: "./model-switch-probe.png",
              },
              model: createMockAIGatewayModel({ provider }),
            })
          )._unsafeUnwrap();

        expect(await read("anthropic")).toEqual(await read("openai"));
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("does not cut a character in half when truncating a long line", async () => {
      // A line over the cap whose 2000th code unit is the first half of an
      // emoji. Slicing at a fixed index leaves a surrogate with no partner,
      // which has no UTF-8 encoding and gets the whole request rejected -- on
      // content that is already saved and replayed on every later turn.
      const probePath = path.join(fixturesPath, "long-line-probe.txt");
      await fs.writeFile(probePath, `${"a".repeat(1999)}🙈${"b".repeat(50)}\n`);

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./long-line-probe.txt" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("exists");
        if (value.state === "exists") {
          expect(
            Buffer.from(value.content, "utf8").toString("utf8"),
          ).toStrictEqual(value.content);
          expect(value.content).toContain(`${"a".repeat(1999)}...`);
        }
      } finally {
        await fs.rm(probePath, { force: true });
      }
    });

    it("refuses an image whose bytes cannot be decoded", async () => {
      // An interrupted download or a truncated write leaves a file that opens
      // as an image and is not one. Handing those bytes to the provider gets
      // the request rejected, and since the part is persisted the rejection
      // repeats on every later turn. (A text file with an image extension is
      // harmless by comparison -- it reads as text and never becomes media.)
      const imagePath = path.join(fixturesPath, "not-really.png");
      await fs.writeFile(
        imagePath,
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      );

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./not-really.png" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("unsupported-format");
        if (value.state === "unsupported-format") {
          expect(value.reason).toBe("undecodable-image");
        }
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("refuses a truncated image that is small enough to pass through", async () => {
      // The gap this closes. Dimensions come from the header, so a file cut in
      // half measures fine; an image inside the preview budget is then passed
      // through byte for byte and never decoded by anything on the way out. So
      // these bytes reached the provider through the one path that skips every
      // other check, and the rejection they earned is permanent.
      const whole = path.join(fixturesPath, "damaged-source.png");
      const imagePath = path.join(fixturesPath, "damaged.png");
      await drawPngFixture(whole, "640x480");

      try {
        const bytes = await fs.readFile(whole);
        expect(measureImage(bytes)).toMatchObject({ height: 480, width: 640 });
        await fs.writeFile(
          imagePath,
          bytes.subarray(0, Math.floor(bytes.byteLength * 0.3)),
        );

        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./damaged.png" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("unsupported-format");
        if (value.state === "unsupported-format") {
          expect(value.reason).toBe("truncated-image");
        }
      } finally {
        await fs.rm(whole, { force: true });
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("refuses an image whose declared dimensions are too large to decode", async () => {
      // Bytes on disk say nothing about pixels in memory, so the size cap never
      // sees this coming. Refused from the header, before a decode -- and built
      // as a header alone, so the test does not spend what the guard refuses.
      const imagePath = path.join(fixturesPath, "decode-bomb.png");
      await fs.writeFile(
        imagePath,
        pngHeaderBytes({ height: 16_000, width: 16_000 }),
      );

      try {
        const stats = await fs.stat(imagePath);
        expect(stats.size).toBeLessThan(MEDIA_CONFIG_IMAGE_MAX_SIZE);

        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./decode-bomb.png" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("unsupported-format");
        if (value.state === "unsupported-format") {
          expect(value.reason).toBe("image-too-large");
        }
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("refuses a PDF that stops before its end marker", async () => {
      // A PDF goes out as media with nothing but a size cap in front of it, so
      // a truncated one bricks a session exactly the way a truncated image did.
      const pdfPath = path.join(fixturesPath, "truncated.pdf");
      await fs.writeFile(pdfPath, "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n");

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./truncated.pdf" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("unsupported-format");
        if (value.state === "unsupported-format") {
          expect(value.reason).toBe("undecodable-pdf");
        }
      } finally {
        await fs.rm(pdfPath, { force: true });
      }
    });

    it("refuses a video whose bytes cannot be decoded", async () => {
      // Half of a real download. MP4 keeps its index at the end of the file, so
      // the half that arrived is undecodable rather than merely short.
      const wholePath = path.join(fixturesPath, "whole.mp4");
      const videoPath = path.join(fixturesPath, "not-really.mp4");
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
        wholePath,
      ]);
      const whole = await fs.readFile(wholePath);
      await fs.writeFile(videoPath, whole.subarray(0, whole.byteLength / 2));
      await fs.rm(wholePath, { force: true });

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./not-really.mp4" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("unsupported-format");
        if (value.state === "unsupported-format") {
          expect(value.reason).toBe("undecodable-media");
        }
      } finally {
        await fs.rm(videoPath, { force: true });
      }
    }, 60_000);

    it("reads a video ffprobe can decode", async () => {
      const videoPath = path.join(fixturesPath, "bars.mp4");
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
        videoPath,
      ]);

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./bars.mp4" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("video");
      } finally {
        await fs.rm(videoPath, { force: true });
      }
    }, 60_000);

    it("reports the format the bytes are, not the one the name claims", async () => {
      const imagePath = path.join(fixturesPath, "mislabeled.jpg");
      const png = path.join(fixturesPath, "mislabeled-source.png");
      await drawPngFixture(png, "320x240");
      await fs.copyFile(png, imagePath);

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: { explanation: "read", filePath: "./mislabeled.jpg" },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("image");
        if (value.state === "image") {
          expect(value.mimeType).toBe("image/png");
        }
      } finally {
        await fs.rm(imagePath, { force: true });
        await fs.rm(png, { force: true });
      }
    }, 60_000);

    it("crops a region from the full-resolution file and magnifies it", async () => {
      const imagePath = path.join(fixturesPath, "region-probe.png");
      await drawPngFixture(imagePath, "3840x2160");

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: {
              explanation: "zoom",
              filePath: "./region-probe.png",
              region: { x1: 100, x2: 500, y1: 100, y2: 400 },
            },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("image");
        if (value.state === "image") {
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
          expect(value.renderedWidth).toBeGreaterThan(500 - 100);
        }
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("clamps a region that runs off the edge of the image", async () => {
      const imagePath = path.join(fixturesPath, "region-clamp-probe.png");
      await drawPngFixture(imagePath, "320x240");

      try {
        const value = (
          await runTool(TOOLS.ReadFile, {
            ...baseInput,
            input: {
              explanation: "zoom",
              filePath: "./region-clamp-probe.png",
              region: { x1: -50, x2: 9000, y1: 100, y2: 50 },
            },
          })
        )._unsafeUnwrap();

        expect(value.state).toBe("image");
        if (value.state === "image") {
          // Corners come back ordered and inside the image, so the model can
          // see what its request was actually taken to mean.
          expect(value.region).toEqual({ x1: 0, x2: 320, y1: 50, y2: 100 });
        }
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it.each([
      // Elongated enough that the view's short edge rounds hard: a single
      // width-derived scale factor is then several percent wrong on the other
      // axis, and a region spanning that edge maps to one pixel past the source
      // and fails the render rather than landing on the edge.
      { name: "a wide image", size: "4001x37" },
      { name: "a tall image", size: "37x4001" },
    ])(
      "renders a region spanning the far edges of $name",
      async ({ size }) => {
        const name = `region-edge-${size}.png`;
        const imagePath = path.join(fixturesPath, name);
        await drawPngFixture(imagePath, size);

        try {
          // Learn the view first, the way the tool tells the model to: a region
          // is expressed in the view's pixel space, not the file's.
          const whole = (
            await runTool(TOOLS.ReadFile, {
              ...baseInput,
              input: { explanation: "look", filePath: `./${name}` },
            })
          )._unsafeUnwrap();

          expect(whole.state).toBe("image");
          if (whole.state !== "image") {
            return;
          }
          const { viewHeight, viewWidth } = whole;
          expect(viewWidth).toBeDefined();
          expect(viewHeight).toBeDefined();
          if (viewWidth === undefined || viewHeight === undefined) {
            return;
          }

          const zoomed = (
            await runTool(TOOLS.ReadFile, {
              ...baseInput,
              input: {
                explanation: "zoom",
                filePath: `./${name}`,
                region: { x1: 0, x2: viewWidth, y1: 0, y2: viewHeight },
              },
            })
          )._unsafeUnwrap();

          expect(zoomed.state).toBe("image");
          if (zoomed.state === "image") {
            expect(zoomed.region).toEqual({
              x1: 0,
              x2: viewWidth,
              y1: 0,
              y2: viewHeight,
            });
          }
        } finally {
          await fs.rm(imagePath, { force: true });
        }
      },
      60_000,
    );

    it("reports an empty region back to the model instead of failing", async () => {
      const imagePath = path.join(fixturesPath, "region-empty-probe.png");
      await drawPngFixture(imagePath, "320x240");

      try {
        const result = await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "zoom",
            filePath: "./region-empty-probe.png",
            region: { x1: 400, x2: 500, y1: 10, y2: 20 },
          },
        });

        expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
          `"Region (400,10)-(500,20) is empty or outside the 320x240 image. Give two corners in that pixel space, with the origin at the top-left."`,
        );
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("refuses a region too small to magnify into anything", async () => {
      const imagePath = path.join(fixturesPath, "region-tiny-probe.png");
      await drawPngFixture(imagePath, "320x240");

      try {
        const result = await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "zoom",
            filePath: "./region-tiny-probe.png",
            region: { x1: 0, x2: 1, y1: 0, y2: 1 },
          },
        });

        // Answering this returns a flat expanse of interpolated color, which
        // reads as "the picture is blank" rather than as "you asked for one
        // pixel". The refusal has to name the size to be actionable.
        expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
          `"Region (0,0)-(1,1) covers 1x1 pixels of the source image, too few to magnify into anything readable. Give a rectangle covering at least 8x8 pixels, in the 320x240 space the image was shown to you in."`,
        );
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("reads the whole image when the region is all zeros", async () => {
      const imagePath = path.join(fixturesPath, "region-zero-probe.png");
      await drawPngFixture(imagePath, "320x240");

      try {
        const result = await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "read",
            filePath: "./region-zero-probe.png",
            region: { x1: 0, x2: 0, y1: 0, y2: 0 },
          },
        });

        // No rectangle comes back, because none was asked for. The empty-region
        // error above still fires for a rectangle that names a place and misses.
        const value = result._unsafeUnwrap();
        expect(value.state).toBe("image");
        expect(value).not.toHaveProperty("region");
      } finally {
        await fs.rm(imagePath, { force: true });
      }
    }, 60_000);

    it("refuses a region on something that is not an image", async () => {
      const result = await runTool(TOOLS.ReadFile, {
        ...baseInput,
        input: {
          explanation: "zoom",
          filePath: "./grep-test.txt",
          region: { x1: 0, x2: 10, y1: 0, y2: 10 },
        },
      });

      expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
        `"region only applies to images, and ./grep-test.txt is not one."`,
      );
    }, 60_000);

    it("reads a file from a read-only attached folder by its mount path", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "read",
            filePath: "/mnt/Test Folder/grep-test.txt",
          },
          taskState: { attachedFolders },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("exists");
      if (value.state === "exists") {
        expect(value.content).toContain("async function testGrep");
        expect(value.filePath).toBe("/mnt/Test Folder/grep-test.txt");
      }
    });

    it("reads a task file addressed by its /task virtual path", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: { explanation: "read", filePath: "/task/grep-test.txt" },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("exists");
      if (value.state === "exists") {
        expect(value.content).toContain("async function testGrep");
        expect(value.filePath).toBe("./grep-test.txt");
      }
    });

    it("should return does-not-exist with suggestions for a similarly-named file", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: { explanation: "read", filePath: "./grep-test.ts" },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("does-not-exist");
      if (value.state === "does-not-exist") {
        expect(value.suggestions).toContain("grep-test.txt");
      }
    });

    it("should respect limit and offset", async () => {
      const value = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "read",
            filePath: "./grep-test.txt",
            limit: 3,
            offset: 3,
          },
        })
      )._unsafeUnwrap();

      expect(value.state).toBe("exists");
      if (value.state === "exists") {
        expect(value.displayedLines).toBe(3);
        expect(value.offset).toBe(3);
        expect(value.content).toContain("async functions");
      }
    });

    it("steers a host path inside an attached folder to its mount path", async () => {
      const error = (
        await runTool(TOOLS.ReadFile, {
          ...baseInput,
          input: {
            explanation: "read",
            filePath: path.join(fixturesPath, "grep-test.txt"),
          },
          taskState: { attachedFolders },
        })
      )._unsafeUnwrapErr();

      expect(error.message).toContain("Test Folder");
      expect(error.message).toContain("mount path");
      expect(error.message).toContain("/mnt/Test Folder");
    });
  });
});

/* eslint-enable unicorn/no-await-expression-member */

describe("ReadFile Unicode path fallbacks", () => {
  let tmpDir: string;
  let taskRoot: string;
  let tmpTaskConfig: TaskId;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${APP_NAME_SLUG}-read-unicode-`),
    );
    taskRoot = path.join(tmpDir, "test");
    await fs.mkdir(taskRoot, { recursive: true });
    tmpTaskConfig = createMockTaskConfigForDir(taskRoot, { model });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true });
  });

  it("reads a macOS screenshot with U+202F narrow no-break space before AM/PM", async () => {
    const diskName = `Screenshot 2025-01-01 at 9.00\u202FAM.png`;
    const inputName = `Screenshot 2025-01-01 at 9.00 AM.png`;
    await fs.writeFile(path.join(taskRoot, diskName), "fake-png-data");

    const value = (
      await runTool(TOOLS.ReadFile, {
        agentName: "main" as const,
        input: { explanation: "read", filePath: `./${inputName}` },
        model,
        signal: AbortSignal.timeout(10_000),
        spawnAgent: vi.fn(),
        taskId: tmpTaskConfig,
        taskState: {},
      })
    )
      // eslint-disable-next-line unicorn/no-await-expression-member
      ._unsafeUnwrap();

    expect(value.state).not.toBe("does-not-exist");
  });
});

describe("toModelOutput", () => {
  it("reports an empty file as a note instead of a blank numbered line", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./empty.ts" },
      output: {
        content: "",
        displayedLines: 1,
        filePath: "./empty.ts",
        hasMoreLines: false,
        modifiedAt: 1_234_567_890_000,
        offset: 1,
        state: "exists",
        totalLines: 1,
        truncatedByBytes: false,
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "<instrument-system-note>
      File ./empty.ts exists but is empty.
      </instrument-system-note>",
      }
    `);
  });

  it("should return error text when file does not exist with suggestions", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./missing.ts" },
      output: {
        filePath: "./missing.ts",
        state: "does-not-exist",
        suggestions: ["./missing.txt", "./missing.tsx"],
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "error-text",
        "value": "File ./missing.ts does not exist

      Did you mean one of these?
      ./missing.txt
      ./missing.tsx",
      }
    `);
  });

  it("should return error text when file does not exist with no suggestions", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./missing.ts" },
      output: {
        filePath: "./missing.ts",
        state: "does-not-exist",
        suggestions: [],
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "error-text",
        "value": "File ./missing.ts does not exist",
      }
    `);
  });

  it("should return error text for unsupported image format", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./photo.bmp" },
      output: {
        filePath: "./photo.bmp",
        mimeType: "image/bmp",
        modifiedAt: expect.any(Number),
        reason: "unsupported-image-format",
        state: "unsupported-format",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "error-text",
        "value": "Unsupported image format: ./photo.bmp (image/bmp). Input should be 'image/jpeg', 'image/png', 'image/webp'. Please convert the image to a supported format before reading.",
      }
    `);
  });

  it("should return error text for binary file with known MIME type", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./archive.zip" },
      output: {
        filePath: "./archive.zip",
        mimeType: "application/zip",
        modifiedAt: expect.any(Number),
        reason: "binary-file",
        state: "unsupported-format",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "error-text",
        "value": "Cannot read binary file (application/zip): ./archive.zip. Consider using command-line tools or scripts to extract or convert the file contents if needed.",
      }
    `);
  });

  it("should return error text for binary file with no MIME type", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./unknown.bin" },
      output: {
        filePath: "./unknown.bin",
        modifiedAt: expect.any(Number),
        reason: "binary-file",
        state: "unsupported-format",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "error-text",
        "value": "Cannot read binary file with unknown MIME type: ./unknown.bin. Consider using command-line tools or scripts to extract or convert the file contents if needed.",
      }
    `);
  });

  it("states both sizes when the model is shown a downscaled copy", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./scan.png" },
      output: {
        base64Data: "abc123",
        filePath: "./scan.png",
        height: 2160,
        mimeType: "image/png",
        modifiedAt: expect.any(Number),
        state: "image",
        viewHeight: 819,
        viewWidth: 1456,
        width: 3840,
      },
      toolCallId: "123",
    });
    expect(result.type === "content" && result.value[0]).toMatchInlineSnapshot(`
      {
        "text": "Image file: ./scan.png (3840x2160 px, shown to you at 1456x819). Small text and closely spaced lines may not survive at that size; read it again with a \`region\` to magnify part of it.",
        "type": "text",
      }
    `);
  });

  // These two look alike and call for opposite responses, and getting that wrong
  // is expensive: a message inviting a conversion on data that is not there sent
  // a model on an unbounded errand. Separate tests rather than a table,
  // so each message stays visible as an inline snapshot.
  function unsupportedFormatMessage(
    reason: "truncated-image" | "undecodable-image" | "undecodable-media",
    mimeType = "image/png",
  ) {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./photo.png" },
      output: {
        filePath: "./photo.png",
        mimeType,
        modifiedAt: 0,
        reason,
        state: "unsupported-format" as const,
      },
      toolCallId: "call-1",
    });
    expect(result.type).toBe("error-text");
    return result.type === "error-text" ? result.value : "";
  }

  it("tells a damaged image to stop rather than convert", () => {
    expect(unsupportedFormatMessage("truncated-image")).toMatchInlineSnapshot(
      `"./photo.png is a truncated image: it declares its format and size, then ends before its data does. The missing bytes cannot be reconstructed by any tool. This format stores its pixels as a single compressed stream, so a partial copy decodes to nothing -- converting it, or opening it with ffmpeg or Python, cannot change that. Do not make more than that one attempt, and do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("tells a truncated JPEG the part that arrived is still worth one look", () => {
    // Verified against ffmpeg: a JPEG cut to 40% still renders its top portion,
    // while a PNG cut the same way decodes to nothing. Telling a capable model
    // the data is gone in both cases would cost a real recovery to bound a
    // careless one.
    expect(
      unsupportedFormatMessage("truncated-image", "image/jpeg"),
    ).toMatchInlineSnapshot(
      `"./photo.png is a truncated image: it declares its format and size, then ends before its data does. The missing bytes cannot be reconstructed by any tool. A JPEG decodes top to bottom, so the part that did arrive is still renderable: if what you need is near the top, one attempt at decoding it is worth making. Do not make more than that one attempt, and do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("bounds the audio and video message it cannot split", () => {
    // A container cannot say which failure it hit -- ffprobe refusing to parse
    // one means either a short download or the wrong format, and nothing cheap
    // separates them. So the message keeps the one useful step and bounds it,
    // rather than leaving the repair loop open the way the image text used to.
    expect(
      unsupportedFormatMessage("undecodable-media", "video/mp4"),
    ).toMatchInlineSnapshot(
      `"Cannot decode ./photo.png (video/mp4): it is either incomplete or not the format its name claims. Identify it once with \`ffprobe -v error -show_format -show_streams -of json ./photo.png\`. If that names a format, converting it is worth one attempt; if it reports a truncated or unknown stream, the data is missing and no conversion will recover it. Either way, do not read this file again. Report that it is unusable and say where it came from, so whoever can replace it knows which step to repeat."`,
    );
  });

  it("tells an unrecognized image to identify itself once", () => {
    expect(unsupportedFormatMessage("undecodable-image")).toMatchInlineSnapshot(
      `"Cannot read ./photo.png as an image: nothing identifies these bytes as one. It may be a different format under an image's name, or not an image at all. Identify it once with \`ffprobe -v error -show_format -show_streams -of json ./photo.png\` or \`file\`. If it is a format that converts, convert it and read the result; if it is not, say so rather than reading this file again."`,
    );
  });

  it("says which rectangle a region read was taken to mean", () => {
    const result = ReadFile.toModelOutput({
      input: {
        explanation: "zoom",
        filePath: "./scan.png",
        region: { x1: 100, x2: 500, y1: 100, y2: 400 },
      },
      output: {
        base64Data: "abc123",
        filePath: "./scan.png",
        height: 2160,
        mimeType: "image/png",
        modifiedAt: expect.any(Number),
        region: { x1: 100, x2: 500, y1: 100, y2: 400 },
        renderedHeight: 952,
        renderedWidth: 1270,
        state: "image",
        viewHeight: 819,
        viewWidth: 1456,
        width: 3840,
      },
      toolCallId: "123",
    });
    expect(result.type === "content" && result.value[0]).toMatchInlineSnapshot(`
      {
        "text": "Image file: ./scan.png -- region (100,100)-(500,400) of the 1456x819 view, cropped from the 3840x2160 original and magnified to 1270x952.",
        "type": "text",
      }
    `);
  });

  it("states one size when the model sees the image at full resolution", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./photo.png" },
      output: {
        base64Data: "abc123",
        filePath: "./photo.png",
        height: 240,
        mimeType: "image/png",
        modifiedAt: expect.any(Number),
        state: "image",
        viewHeight: 240,
        viewWidth: 320,
        width: 320,
      },
      toolCallId: "123",
    });
    expect(result.type === "content" && result.value[0]).toMatchInlineSnapshot(`
      {
        "text": "Image file: ./photo.png (320x240 px).",
        "type": "text",
      }
    `);
  });

  it("should return content with media block for image files", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./photo.png" },
      output: {
        base64Data: "abc123",
        filePath: "./photo.png",
        mimeType: "image/png",
        modifiedAt: expect.any(Number),
        state: "image",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "content",
        "value": [
          {
            "text": "Image file: ./photo.png.",
            "type": "text",
          },
          {
            "data": "abc123",
            "mediaType": "image/png",
            "type": "media",
          },
        ],
      }
    `);
  });

  it("should return content with media block for pdf files", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./doc.pdf" },
      output: {
        base64Data: "abc123",
        filePath: "./doc.pdf",
        mimeType: "application/pdf",
        modifiedAt: expect.any(Number),
        state: "pdf",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "content",
        "value": [
          {
            "text": "PDF file: ./doc.pdf.",
            "type": "text",
          },
          {
            "data": "abc123",
            "mediaType": "application/pdf",
            "type": "media",
          },
        ],
      }
    `);
  });

  it("should return content with media block for audio files", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./sound.mp3" },
      output: {
        base64Data: "abc123",
        filePath: "./sound.mp3",
        mimeType: "audio/mpeg",
        modifiedAt: expect.any(Number),
        state: "audio",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "content",
        "value": [
          {
            "text": "Audio file: ./sound.mp3.",
            "type": "text",
          },
          {
            "data": "abc123",
            "mediaType": "audio/mpeg",
            "type": "media",
          },
        ],
      }
    `);
  });

  it("should return content with media block for video files", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./clip.mp4" },
      output: {
        base64Data: "abc123",
        filePath: "./clip.mp4",
        mimeType: "video/mp4",
        modifiedAt: expect.any(Number),
        state: "video",
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "content",
        "value": [
          {
            "text": "Video file: ./clip.mp4.",
            "type": "text",
          },
          {
            "data": "abc123",
            "mediaType": "video/mp4",
            "type": "media",
          },
        ],
      }
    `);
  });

  it("should format entire file content", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./foo.ts" },
      output: {
        content: "const x = 1;\nconst y = 2;",
        displayedLines: 2,
        filePath: "./foo.ts",
        hasMoreLines: false,
        modifiedAt: expect.any(Number),
        offset: 1,
        state: "exists",
        totalLines: 2,
        truncatedByBytes: false,
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
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

  it("should format partial file with hidden lines before and after", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./foo.ts", limit: 3, offset: 5 },
      output: {
        content: "line5\nline6\nline7",
        displayedLines: 3,
        filePath: "./foo.ts",
        hasMoreLines: true,
        modifiedAt: expect.any(Number),
        offset: 5,
        state: "exists",
        totalLines: 20,
        truncatedByBytes: false,
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
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

  it("should show byte-cap truncation message", () => {
    const result = ReadFile.toModelOutput({
      input: { explanation: "read", filePath: "./big.ts" },
      output: {
        content: "line1\nline2",
        displayedLines: 2,
        filePath: "./big.ts",
        hasMoreLines: true,
        modifiedAt: expect.any(Number),
        offset: 1,
        state: "exists",
        totalLines: 500,
        truncatedByBytes: true,
      },
      toolCallId: "123",
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "<path>./big.ts</path>
      <content lines="lines 1-2 (total 500 lines)">
         1→line1
         2→line2
      ... 498 lines not shown (output capped at 50KB) ...

      (Use offset parameter to read beyond line 2)
      </content>",
      }
    `);
  });
});
