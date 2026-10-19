import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../../test/helpers/temp-dir";
import { blobPath, isBlobName, writeBlob } from "./blobs";

const dir = withTempDir("records-blobs");

const PNG_BYTES = Buffer.from("not really a png");

describe("writeBlob", () => {
  it("names the bytes by their hash and media type, with nothing left behind", async () => {
    const name = await writeBlob(dir.path, PNG_BYTES, "image/png");

    expect(isBlobName(name)).toBe(true);
    expect(name).toBe(
      `sha256-${createHash("sha256").update(PNG_BYTES).digest("hex")}.png`,
    );
    await expect(fs.readFile(blobPath(dir.path, name))).resolves.toEqual(
      PNG_BYTES,
    );
    await expect(fs.readdir(path.join(dir.path, "blobs"))).resolves.toEqual([
      name,
    ]);
  });

  it("gives the same bytes the same name", async () => {
    const first = await writeBlob(dir.path, PNG_BYTES, "image/png");
    const second = await writeBlob(
      dir.path,
      Buffer.from(PNG_BYTES),
      "image/png",
    );

    expect(second).toBe(first);
  });

  it("leaves a blob that is already there alone", async () => {
    const name = await writeBlob(dir.path, PNG_BYTES, "image/png");
    // Whatever is under the name stays: a blob is never written over.
    await fs.writeFile(blobPath(dir.path, name), "already here");

    await writeBlob(dir.path, PNG_BYTES, "image/png");

    await expect(fs.readFile(blobPath(dir.path, name), "utf8")).resolves.toBe(
      "already here",
    );
  });

  it("writes one file when many ask for the same bytes at once", async () => {
    const names = await Promise.all(
      Array.from({ length: 20 }, () =>
        writeBlob(dir.path, PNG_BYTES, "image/png"),
      ),
    );

    expect(new Set(names).size).toBe(1);
    await expect(fs.readdir(path.join(dir.path, "blobs"))).resolves.toEqual([
      names[0],
    ]);
  });

  it("names bytes of a media type it does not know .bin", async () => {
    await expect(
      writeBlob(dir.path, PNG_BYTES, "application/x-unheard-of"),
    ).resolves.toMatch(/\.bin$/);
  });
});
