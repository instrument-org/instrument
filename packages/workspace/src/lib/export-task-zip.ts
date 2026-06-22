import { ZipWriter } from "@zip.js/zip.js";
import { okAsync, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";

import { SESSIONS_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import { type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { filterIgnoredFiles } from "./filter-ignored-files";
import { getIgnore } from "./get-ignore";
import { pathExists } from "./path-exists";

interface ExportTaskZipOptions {
  dir: TaskDir;
  outputPath: string;
}

export function exportTaskZip({ dir, outputPath }: ExportTaskZipOptions) {
  return safeTry(async function* () {
    const ignore = yield* ResultAsync.fromPromise(
      getIgnore(dir, { includeGit: true }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to get ignore patterns: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    const { files } = yield* ResultAsync.fromPromise(
      filterIgnoredFiles({ ignore, includeGit: true, rootDir: dir }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to filter files: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    const filesToInclude = new Set(files);

    const sessionsDbPath = absolutePathJoin(
      dir,
      TASK_FOLDER_NAMES.private,
      SESSIONS_DB_FILE_NAME,
    );
    const sessionsDbExists = await pathExists(sessionsDbPath);

    if (sessionsDbExists) {
      filesToInclude.add(
        path.join(TASK_FOLDER_NAMES.private, SESSIONS_DB_FILE_NAME),
      );
    }

    yield* ResultAsync.fromPromise(
      (async () => {
        const fileHandle = await fs.open(outputPath, "w");
        const writeStream = fileHandle.createWriteStream();
        const writableStream = Writable.toWeb(writeStream);

        const zipWriter = new ZipWriter(writableStream);

        for (const file of filesToInclude) {
          const fullPath = absolutePathJoin(dir, file);
          const fileStats = await fs.stat(fullPath);

          if (fileStats.isFile()) {
            const readHandle = await fs.open(fullPath, "r");
            const readStream = readHandle.createReadStream();
            const fileStream = Readable.toWeb(readStream);

            // Casting due to Node.js mismatches between the stream types
            await zipWriter.add(file, fileStream as ReadableStream, {
              lastModDate: fileStats.mtime,
            });
          }
        }

        await zipWriter.close();
        await fileHandle.close();
      })(),
      (error) =>
        new TypedError.FileSystem(
          `Failed to create zip file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return okAsync({ outputPath });
  });
}
