import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type AbsolutePath,
  AbsolutePathSchema,
  TaskDirSchema,
} from "../schemas/paths";
import { TypedError } from "./errors";
import { normalizePath } from "./normalize-path";

// Extracts a task zip into outputDir, verifying it contains a manifest.
// Shared by importTask (RPC) and the dump-session-transcript script.
export async function extractTaskZip({
  outputDir,
  zipBlob,
}: {
  outputDir: AbsolutePath;
  zipBlob: Blob;
}): Promise<{ dir: ReturnType<typeof TaskDirSchema.parse> }> {
  const zipReader = new ZipReader(new BlobReader(zipBlob));
  const entries = await zipReader.getEntries();

  const hasManifest = entries.some(
    (entry) => entry.filename === TASK_SETTINGS_FILE_NAME,
  );
  if (!hasManifest) {
    throw new TypedError.NotFound(
      `Zip file does not contain ${TASK_SETTINGS_FILE_NAME}`,
    );
  }

  await fs.mkdir(outputDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.filename || entry.directory) {
      continue;
    }

    // Needed for importing a task from Windows on a POSIX machine.
    const normalizedFilename = normalizePath(entry.filename);
    const fullPath = resolvePathWithinOutputDir({
      outputDir,
      relativePath: normalizedFilename,
    });
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    const writer = new BlobWriter();
    const entryBlob = await entry.getData(writer);
    const arrayBuffer = await entryBlob.arrayBuffer();
    await fs.writeFile(fullPath, Buffer.from(arrayBuffer));
  }

  await zipReader.close();

  return { dir: TaskDirSchema.parse(outputDir) };
}

function resolvePathWithinOutputDir({
  outputDir,
  relativePath,
}: {
  outputDir: AbsolutePath;
  relativePath: string;
}): AbsolutePath {
  const fullPath = path.resolve(outputDir, relativePath);
  if (!`${fullPath}${path.sep}`.startsWith(`${outputDir}${path.sep}`)) {
    throw new TypedError.FileSystem(
      `Zip entry escapes output directory: ${relativePath}`,
    );
  }
  return AbsolutePathSchema.parse(fullPath);
}
