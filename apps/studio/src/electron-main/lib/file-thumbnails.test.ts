import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createThumbnailFromPath = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: () => "" },
  nativeImage: {
    createFromBitmap: (
      bitmap: Buffer,
      size: { height: number; width: number },
    ) =>
      picture(
        // The picture at the top, white carried on beneath it.
        `${bitmap[0] === 0 && bitmap.at(-1) === 0xff ? "page" : "?"} ${size.width}x${size.height}`,
        size,
      ),
    createFromBuffer: (png: Buffer) => picture(png.toString()),
    createFromPath: () => ({ isEmpty: () => true }),
    createThumbnailFromPath,
  },
}));

const { fileThumbnail } = await import("./file-thumbnails");

interface Picture {
  getSize: () => { height: number; width: number };
  isEmpty: () => boolean;
  toBitmap: () => Buffer;
  toPNG: () => Buffer;
}

const SQUARE = { height: 100, width: 100 };

function picture(bytes: string, size = SQUARE): Picture {
  return {
    getSize: () => size,
    isEmpty: () => false,
    // Dark, so the white a page is carried on in tells apart from it.
    toBitmap: () => Buffer.alloc(size.width * size.height * 4, 0),
    toPNG: () => Buffer.from(bytes),
  };
}

let root: string;
let file: string;
let dir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "file-thumbnails-"));
  file = path.join(root, "notes.md");
  dir = path.join(root, "cache");
  await fs.writeFile(file, "# Notes");
  createThumbnailFromPath.mockReset();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { force: true, recursive: true });
});

describe("fileThumbnail", () => {
  it("draws a file once and reads it from disk after that", async () => {
    createThumbnailFromPath.mockResolvedValue(picture("first"));
    const first = await fileThumbnail(file, 512, { dir });
    const second = await fileThumbnail(file, 512, { dir });
    expect([first?.toString(), second?.toString()]).toEqual([
      "page 100x128",
      "page 100x128",
    ]);
    expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it("draws a file again once it has been written", async () => {
    createThumbnailFromPath.mockResolvedValueOnce(picture("before"));
    await fileThumbnail(file, 512, { dir });
    await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
    createThumbnailFromPath.mockResolvedValueOnce(picture("after"));
    const redrawn = await fileThumbnail(file, 512, { dir });
    expect(redrawn?.toString()).toBe("page 100x128");
  });

  it("keeps a picture in its own shape", async () => {
    const photo = path.join(root, "photo.jpg");
    await fs.writeFile(photo, "");
    createThumbnailFromPath.mockResolvedValue(picture("photo"));
    const drawn = await fileThumbnail(photo, 512, { dir });
    expect(drawn?.toString()).toBe("photo");
  });

  it("remembers a file the system has no picture of", async () => {
    createThumbnailFromPath.mockRejectedValue(new Error("no thumbnail"));
    expect(await fileThumbnail(file, 64, { dir })).toBeNull();
    expect(await fileThumbnail(file, 64, { dir })).toBeNull();
    expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it("shares one drawing between asks that arrive together", async () => {
    createThumbnailFromPath.mockResolvedValue(picture("shared"));
    await Promise.all([
      fileThumbnail(file, 512, { dir }),
      fileThumbnail(file, 512, { dir }),
    ]);
    expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });
});
