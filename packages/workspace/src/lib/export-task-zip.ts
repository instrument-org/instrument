import { ZipWriter } from "@zip.js/zip.js";
import { okAsync, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import { Readable, Writable } from "node:stream";

import { TASK_FOLDER_NAMES } from "../constants";
import { type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";

interface ExportTaskZipOptions {
  dir: TaskDir;
  outputPath: string;
}

// Bundle the whole task folder except: node_modules (large, and rebuilt by
// pnpm install from the lockfile), .git (not needed to reproduce the task), and
// the browser profile/home (auth cookies + local browser config). The first two
// are matched by name at any depth; the browser dirs at their fixed paths under
// the private dir.
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules"]);
const EXCLUDED_RELATIVE_DIRS = new Set([
  `${TASK_FOLDER_NAMES.private}/${TASK_FOLDER_NAMES.browserSession}`,
  // The agent-browser CLI's $HOME (its `.agent-browser` config), not the profile.
  `${TASK_FOLDER_NAMES.private}/agent-browser-home`,
]);

export function exportTaskZip({ dir, outputPath }: ExportTaskZipOptions) {
  return safeTry(async function* () {
    const files = yield* ResultAsync.fromPromise(
      collectExportFiles(dir),
      (error) =>
        new TypedError.FileSystem(
          `Failed to list task files: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    yield* ResultAsync.fromPromise(
      writeZip({ dir, files, outputPath }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to create zip file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return okAsync({ outputPath });
  });
}

// Lists every file in the task dir as POSIX-relative paths, skipping excluded
// dirs. Symlinks are skipped so the archive can't reach outside the task dir.
async function collectExportFiles(dir: TaskDir): Promise<string[]> {
  const files: string[] = [];
  const dirStack: string[] = [""];

  while (dirStack.length > 0) {
    const relativeDir = dirStack.pop();
    if (relativeDir === undefined) {
      continue;
    }

    const absoluteDir = relativeDir ? absolutePathJoin(dir, relativeDir) : dir;
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        if (
          EXCLUDED_DIR_NAMES.has(entry.name) ||
          EXCLUDED_RELATIVE_DIRS.has(relativePath)
        ) {
          continue;
        }
        dirStack.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  return files.sort();
}

async function writeZip({
  dir,
  files,
  outputPath,
}: {
  dir: TaskDir;
  files: string[];
  outputPath: string;
}): Promise<void> {
  const fileHandle = await fs.open(outputPath, "w");
  const writeStream = fileHandle.createWriteStream();
  const writableStream = Writable.toWeb(writeStream);
  const zipWriter = new ZipWriter(writableStream);

  for (const file of files) {
    const fullPath = absolutePathJoin(dir, file);
    const fileStats = await fs.stat(fullPath);
    if (!fileStats.isFile()) {
      continue;
    }

    const readHandle = await fs.open(fullPath, "r");
    const readStream = readHandle.createReadStream();
    const fileStream = Readable.toWeb(readStream);

    // Casting due to Node.js mismatches between the stream types
    await zipWriter.add(file, fileStream as ReadableStream, {
      lastModDate: fileStats.mtime,
    });
  }

  await zipWriter.close();
  await fileHandle.close();
}
