import { TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../constants";
import { RelativePathSchema, type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { getIgnore } from "./get-ignore";
import { getMimeType } from "./get-mime-type";
import { normalizePath } from "./normalize-path";
import { taskDir } from "./task-dir-utils";

export const INTERNAL_IGNORE_PATTERNS = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  TASK_FOLDER_NAMES.private,
  `${TASK_FOLDER_NAMES.private}/**`,
  TASK_FOLDER_NAMES.state,
  `${TASK_FOLDER_NAMES.state}/**`,
  TASK_FOLDER_NAMES.tmp,
  `${TASK_FOLDER_NAMES.tmp}/**`,
  TASK_SETTINGS_FILE_NAME,
  // Generated lockfile (rewritten by every pnpm install, incl. inside loaded
  // skills). Never read or hand-edited; bare name matches at any depth. We do
  // not ignore pnpm-workspace.yaml: it is real, occasionally agent-edited config
  // that should stay enumerated and surface in chat when changed.
  "pnpm-lock.yaml",
];

const TaskFileSchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  modifiedAt: z.number(),
  size: z.number(),
});

export const TaskFilesSchema = z.array(TaskFileSchema);

export const MAX_TASK_FILE_INDEX_FILES = 5000;

export type TaskFile = z.output<typeof TaskFileSchema>;
export type TaskFileChange = TaskFile & {
  status: "added" | "deleted" | "modified";
};
export type TaskFileIndex = Map<string, TaskFileEntry>;

const TaskFileIndexEntrySchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  mtimeMs: z.number(),
  size: z.number(),
});

type TaskFileEntry = z.output<typeof TaskFileIndexEntrySchema>;

// Serializable form of the index, used to persist a baseline across turns.
export const TaskFileIndexSnapshotSchema = z.array(TaskFileIndexEntrySchema);

export function diffTaskFileIndexes({
  after,
  before,
}: {
  after: TaskFileIndex;
  before: TaskFileIndex;
}): TaskFileChange[] {
  const changes: TaskFileChange[] = [];

  for (const [filePath, file] of after) {
    const previous = before.get(filePath);
    if (!previous) {
      changes.push({ ...toTaskFile(file), status: "added" });
      continue;
    }

    if (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
      changes.push({ ...toTaskFile(file), status: "modified" });
    }
  }

  for (const [filePath, file] of before) {
    if (after.has(filePath)) {
      continue;
    }
    changes.push({ ...toTaskFile(file), status: "deleted" });
  }

  return changes.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export async function getTaskFileIndex(
  dir: TaskDir,
  {
    maxFiles = MAX_TASK_FILE_INDEX_FILES,
    signal,
  }: { maxFiles?: number; signal?: AbortSignal } = {},
) {
  try {
    const ignore = await getIgnore(dir, { signal });
    ignore.add(INTERNAL_IGNORE_PATTERNS);

    const files: TaskFileEntry[] = [];
    let reachedFileLimit = false;

    async function walk(relativeDir: string) {
      signal?.throwIfAborted();
      if (reachedFileLimit) {
        return;
      }

      const absoluteDir = relativeDir
        ? absolutePathJoin(dir, relativeDir)
        : dir;
      const entries = await fs.readdir(absoluteDir, {
        withFileTypes: true,
      });

      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        signal?.throwIfAborted();

        const relativePath = normalizePath(
          relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
        );

        // A filename containing backslashes (treated as separators by
        // normalizePath) can collapse into a traversal path that escapes
        // dir. Skip rather than letting lstat throw and abort the walk.
        if (relativePath === ".." || relativePath.startsWith("../")) {
          continue;
        }

        if (
          ignore.ignores(relativePath) ||
          ignore.ignores(`${relativePath}/`)
        ) {
          continue;
        }

        const absolutePath = absolutePathJoin(dir, relativePath);

        if (entry.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(relativePath);
          continue;
        }

        const stats = await fs.lstat(absolutePath);
        if (!stats.isFile()) {
          continue;
        }

        if (files.length >= maxFiles) {
          reachedFileLimit = true;
          return;
        }

        const filePath = RelativePathSchema.parse(relativePath);
        files.push({
          filename: path.basename(relativePath),
          filePath,
          mimeType: getMimeType(relativePath),
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      }
    }

    await walk("");

    return ok(new Map(files.map((file) => [file.filePath, file])));
  } catch (error) {
    return err(
      new TypedError.FileSystem("Error listing task files", {
        cause: error,
      }),
    );
  }
}

export async function getTaskFiles(taskId: TaskId) {
  const indexResult = await getTaskFileIndex(taskDir(taskId));
  if (indexResult.isErr()) {
    return err(indexResult.error);
  }

  return ok(taskFilesFromIndex(indexResult.value));
}

export function outputArtifactsFromChanges(changes: TaskFileChange[]) {
  return changes
    .filter(
      (change) =>
        change.status !== "deleted" &&
        change.filePath.startsWith(`${TASK_FOLDER_NAMES.output}/`),
    )
    .map(({ filePath, modifiedAt }) => ({ filePath, modifiedAt }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function taskFileIndexFromSnapshot(
  snapshot: TaskFileEntry[],
): TaskFileIndex {
  return new Map(snapshot.map((entry) => [entry.filePath, entry]));
}

export function taskFileIndexToSnapshot(index: TaskFileIndex): TaskFileEntry[] {
  return [...index.values()];
}

export function taskFilesFromIndex(index: TaskFileIndex): TaskFile[] {
  return [...index.values()]
    .map(toTaskFile)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function toTaskFile({ mtimeMs, ...file }: TaskFileEntry): TaskFile {
  return {
    ...file,
    modifiedAt: mtimeMs,
  };
}
