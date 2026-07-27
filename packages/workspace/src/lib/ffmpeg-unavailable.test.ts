import type * as ExecaModule from "execa";

import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pngHeaderBytes } from "../test/helpers/png-header";

// ffmpeg is bundled, so this stands in for the machine where the bundled binary
// will not run: a build that does not match the CPU, a hardened mount, an
// antivirus quarantine. Nothing about it is the image's fault, and the whole
// point of these tests is that nothing behaves as though it were.
vi.mock("./ffmpeg", () => ({
  FFMPEG_PATH: "/nonexistent/instrument-test-ffmpeg",
  ffmpegSubprocessEnv: () => ({}),
  FFPROBE_PATH: "/nonexistent/instrument-test-ffprobe",
}));

vi.mock("execa", async (importOriginal) => {
  const actual = await importOriginal<typeof ExecaModule>();
  return { ...actual, execa: vi.fn(actual.execa) };
});

const OVERSIZED_PNG = pngHeaderBytes({ height: 3000, width: 4000 });

describe("when ffmpeg cannot run", () => {
  beforeEach(() => {
    vi.mocked(execa).mockClear();
  });

  it("says so once instead of walking the whole shrink ladder", async () => {
    const { renderImage } = await import("./render-image");

    const result = await renderImage({
      bytes: OVERSIZED_PNG,
      maxBytes: 1024,
      target: { height: 200, width: 400 },
    });

    expect(result).toEqual({ state: "unavailable" });
    // Six shrink steps of five encodings each would be thirty spawns, per image,
    // on every turn that replays the transcript.
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("sends an over-budget image as it is rather than dropping it", async () => {
    const { normalizeModelImages } = await import("./normalize-model-images");

    const [message] = await normalizeModelImages({
      messages: [
        {
          content: [
            {
              data: OVERSIZED_PNG,
              mediaType: "image/png",
              type: "file",
            },
          ],
          role: "user",
        },
      ],
    });

    // Unresized, so the provider applies its own downscale -- which is what
    // happened before this pass existed. The alternative is an [Image omitted]
    // placeholder for a file that is perfectly readable.
    expect(message?.content).toMatchObject([
      { mediaType: "image/png", type: "file" },
    ]);
  });

  it("shows a file read the whole image, at the size it really is", async () => {
    const { previewImage } = await import("./image-preview");

    const preview = await previewImage({
      fileData: OVERSIZED_PNG,
      signal: AbortSignal.timeout(10_000),
      size: { height: 3000, mediaType: "image/png", width: 4000 },
      target: { height: 1176, width: 1568 },
    });

    // The view is the file's own size, so the text never names a pixel space
    // nobody produced. The provider downscales from here, as it always could.
    expect(preview._unsafeUnwrap()).toMatchObject({
      mediaType: "image/png",
      view: { height: 3000, width: 4000 },
    });
  });

  it("tells a region read what is missing, not that the file is bad", async () => {
    const { cropRegion } = await import("./image-preview");
    const { PREVIEW_LIMITS } = await import("./image-view-size");

    const cropped = await cropRegion({
      fileData: OVERSIZED_PNG,
      limits: PREVIEW_LIMITS,
      region: { x1: 100, x2: 400, y1: 100, y2: 300 },
      signal: AbortSignal.timeout(10_000),
      size: { height: 3000, width: 4000 },
      view: { height: 3000, width: 4000 },
    });

    expect(cropped._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"Image conversion is unavailable on this system, so this image cannot be resized or magnified. Read it without a region, or convert it to a smaller PNG or JPEG and read that."`,
    );
  });

  it("does not let one unrunnable render hide the image on later turns", async () => {
    const { normalizeModelImages } = await import("./normalize-model-images");
    const messages = [
      {
        content: [
          {
            data: OVERSIZED_PNG,
            mediaType: "image/png",
            type: "file" as const,
          },
        ],
        role: "user" as const,
      },
    ];

    await normalizeModelImages({ messages });
    vi.mocked(execa).mockClear();
    await normalizeModelImages({ messages });

    // A verdict about the machine must not reach the render cache, which is
    // keyed on bytes alone and outlives the turn that produced it.
    expect(execa).toHaveBeenCalledTimes(1);
  });
});
