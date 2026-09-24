import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createThumbnailFromPath = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: () => "" },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createThumbnailFromPath,
  },
}));

const { fileThumbnail } = await import("./file-thumbnails");

const picture = (
  bytes: string,
  size = { height: 100, width: 100 },
): {
  crop: (rect: { height: number; width: number }) => unknown;
  getSize: () => { height: number; width: number };
  isEmpty: () => boolean;
  toPNG: () => Buffer;
} => ({
  crop: (rect) => picture(`${bytes} cropped to ${rect.width}x${rect.height}`, rect),
  getSize: () => size,
  isEmpty: () => false,
  toPNG: () => Buffer.from(bytes),
});

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
      "first cropped to 78x100",
      "first cropped to 78x100",
    ]);
    expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it("draws a file again once it has been written", async () => {
    createThumbnailFromPath.mockResolvedValueOnce(picture("before"));
    await fileThumbnail(file, 512, { dir });
    await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
    createThumbnailFromPath.mockResolvedValueOnce(picture("after"));
    const redrawn = await fileThumbnail(file, 512, { dir });
    expect(redrawn?.toString()).toBe("after cropped to 78x100");
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
