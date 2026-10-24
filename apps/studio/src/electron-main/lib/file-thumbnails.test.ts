import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createThumbnailFromPath = vi.fn();
const renderPicture = vi.fn();

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

vi.mock("./rendered-pictures", () => ({ renderPicture }));

const { fileThumbnail, pruneThumbnails } = await import("./file-thumbnails");

interface Picture {
  getSize: () => { height: number; width: number };
  isEmpty: () => boolean;
  resize: (size: { height: number; width: number }) => Picture;
  toBitmap: () => Buffer;
  toJPEG: () => Buffer;
  toPNG: () => Buffer;
}

const SQUARE = { height: 100, width: 100 };

function picture(bytes: string, size = SQUARE, opaque = false): Picture {
  return {
    getSize: () => size,
    isEmpty: () => false,
    resize: (to) => picture(`${bytes} ${to.width}x${to.height}`, to, opaque),
    // Dark and see-through, so the white a page is carried on in tells apart
    // from it; every byte full where it is opaque.
    toBitmap: () =>
      Buffer.alloc(size.width * size.height * 4, opaque ? 0xff : 0),
    toJPEG: () => Buffer.from(`jpeg ${bytes}`),
    toPNG: () => Buffer.from(bytes),
  };
}

let root: string;
let file: string;
let dir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "file-thumbnails-"));
  file = path.join(root, "notes.rtf");
  dir = path.join(root, "cache");
  await fs.writeFile(file, "# Notes");
  createThumbnailFromPath.mockReset();
  renderPicture.mockReset();
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
    expect([first?.bytes.toString(), second?.bytes.toString()]).toEqual([
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
    expect(redrawn?.bytes.toString()).toBe("page 100x128");
  });

  it("keeps a picture in its own shape", async () => {
    const photo = path.join(root, "photo.jpg");
    await fs.writeFile(photo, "");
    createThumbnailFromPath.mockResolvedValue(picture("photo"));
    const drawn = await fileThumbnail(photo, 512, { dir });
    expect(drawn?.bytes.toString()).toBe("photo");
  });

  it.each([
    [true, "jpg", "jpeg photo"],
    [false, "png", "photo"],
  ] as const)(
    "keeps a picture that is opaque: %s as %s",
    async (opaque, format, bytes) => {
      const photo = path.join(root, "photo.jpg");
      await fs.writeFile(photo, "");
      createThumbnailFromPath.mockResolvedValue(
        picture("photo", SQUARE, opaque),
      );
      const drawn = await fileThumbnail(photo, 512, { dir });
      const kept = await fileThumbnail(photo, 512, { dir });
      expect(
        [drawn, kept].map(
          (each) => each && [each.format, each.bytes.toString()],
        ),
      ).toEqual([
        [format, bytes],
        [format, bytes],
      ]);
      expect(createThumbnailFromPath).toHaveBeenCalledTimes(1);
    },
  );

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

  it("draws a page once, at the largest size, and scales the others from it", async () => {
    const page = path.join(root, "page.html");
    await fs.writeFile(page, "<p>hi</p>");
    renderPicture.mockResolvedValue({
      complete: true,
      image: picture("page", { height: 1024, width: 798 }),
    });
    const [large, small] = await Promise.all([
      fileThumbnail(page, 1024, { dir }),
      fileThumbnail(page, 64, { dir }),
    ]);
    expect([large?.bytes.toString(), small?.bytes.toString()]).toEqual([
      "page",
      "page 50x64",
    ]);
    expect(renderPicture).toHaveBeenCalledTimes(1);
    expect(createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it("draws a page again when it was photographed before it loaded", async () => {
    const page = path.join(root, "page.html");
    await fs.writeFile(page, "<p>hi</p>");
    renderPicture.mockResolvedValue({
      complete: false,
      image: picture("partial", { height: 1024, width: 798 }),
    });
    await fileThumbnail(page, 512, { dir });
    await fileThumbnail(page, 1024, { dir });
    expect(renderPicture).toHaveBeenCalledTimes(2);
  });

  it("draws a page again at the same size when it was photographed before it loaded", async () => {
    const page = path.join(root, "page.html");
    await fs.writeFile(page, "<p>hi</p>");
    renderPicture
      .mockResolvedValueOnce({
        complete: false,
        image: picture("partial", { height: 1024, width: 798 }),
      })
      .mockResolvedValueOnce({
        complete: true,
        image: picture("whole", { height: 1024, width: 798 }),
      });
    const first = await fileThumbnail(page, 512, { dir });
    const second = await fileThumbnail(page, 512, { dir });
    expect(
      [first, second].map(
        (each) =>
          each && { complete: each.complete, png: each.bytes.toString() },
      ),
    ).toEqual([
      { complete: false, png: "partial 399x512" },
      { complete: true, png: "whole 399x512" },
    ]);
    expect(renderPicture).toHaveBeenCalledTimes(2);
  });

  it("leaves a file the app cannot draw to the system", async () => {
    const code = path.join(root, "main.ts");
    await fs.writeFile(code, "export {};");
    renderPicture.mockRejectedValue(new Error("no window"));
    createThumbnailFromPath.mockResolvedValue(picture("system"));
    const drawn = await fileThumbnail(code, 512, { dir });
    expect(drawn?.bytes.toString()).toBe("system");
  });
});

describe("pruneThumbnails", () => {
  const KEEP = { bytes: 1000, count: 10, ms: 60_000 };

  /** A thumbnail of `bytes`, drawn `agoMs` ago. */
  async function drawn(name: string, bytes: number, agoMs = 0) {
    const at = new Date(Date.now() - agoMs);
    await fs.writeFile(path.join(dir, name), Buffer.alloc(bytes, 0));
    await fs.utimes(path.join(dir, name), at, at);
  }

  async function left() {
    return (await fs.readdir(dir)).sort();
  }

  beforeEach(async () => {
    await fs.mkdir(dir, { recursive: true });
  });

  it("keeps what is inside the keep", async () => {
    await drawn("a.png", 100, 1000);
    await drawn("b.png", 100);
    await pruneThumbnails(dir, KEEP);
    expect(await left()).toEqual(["a.png", "b.png"]);
  });

  it("lets go of one drawn longer ago than the age", async () => {
    await drawn("old.png", 10, 90_000);
    await drawn("new.png", 10, 1000);
    await pruneThumbnails(dir, KEEP);
    expect(await left()).toEqual(["new.png"]);
  });

  it("lets the oldest go past the count", async () => {
    for (let index = 0; index < 12; index += 1) {
      await drawn(`${index}.png`, 10, (12 - index) * 1000);
    }
    await pruneThumbnails(dir, KEEP);
    expect(await left()).toEqual([
      "10.png",
      "11.png",
      "2.png",
      "3.png",
      "4.png",
      "5.png",
      "6.png",
      "7.png",
      "8.png",
      "9.png",
    ]);
  });

  it("lets the oldest go past the size, with room still inside the count", async () => {
    await drawn("big-old.png", 600, 3000);
    await drawn("big-new.png", 600, 1000);
    await pruneThumbnails(dir, KEEP);
    expect(await left()).toEqual(["big-new.png"]);
  });

  it("says so rather than throwing when it cannot read the folder", async () => {
    await expect(
      pruneThumbnails(path.join(root, "never-drawn"), KEEP),
    ).resolves.toBeUndefined();
  });
});
