import { PROJECT_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TaskDirSchema } from "../schemas/paths";
import { TypedError } from "./errors";
import { extractTaskZip } from "./extract-task-zip";

async function createZipBlob(
  entries: { data: string; filename: string }[],
): Promise<Blob> {
  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));

  for (const entry of entries) {
    await zipWriter.add(entry.filename, new TextReader(entry.data));
  }

  return zipWriter.close();
}

describe("extractTaskZip", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { force: true, recursive: true })),
    );
  });

  it("extracts valid entries under the output directory", async () => {
    const outputDir = TaskDirSchema.parse(
      await fs.mkdtemp(path.join(os.tmpdir(), "extract-project-zip-")),
    );
    tempDirs.push(outputDir);

    const zipBlob = await createZipBlob([
      { data: "{}", filename: PROJECT_MANIFEST_FILE_NAME },
      { data: "hello", filename: "notes/readme.txt" },
    ]);

    await extractTaskZip({ outputDir, zipBlob });

    const readme = await fs.readFile(
      path.join(outputDir, "notes/readme.txt"),
      "utf8",
    );
    expect(readme).toBe("hello");
  });

  it.each(["../../escape.txt", "../../../escape.txt"])(
    "rejects zip entries that escape the output directory (%s)",
    async (filename) => {
      const outputDir = TaskDirSchema.parse(
        await fs.mkdtemp(path.join(os.tmpdir(), "extract-project-zip-")),
      );
      tempDirs.push(outputDir);

      const outsidePath = path.resolve(outputDir, filename);
      const zipBlob = await createZipBlob([
        { data: "{}", filename: PROJECT_MANIFEST_FILE_NAME },
        { data: "pwned", filename },
      ]);

      await expect(
        extractTaskZip({ outputDir, zipBlob }),
      ).rejects.toBeInstanceOf(TypedError.FileSystem);
      await expect(fs.stat(outsidePath)).rejects.toThrow();
    },
  );
});
