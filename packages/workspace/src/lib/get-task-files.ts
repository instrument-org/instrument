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
import { SKILL_ARTIFACT_IGNORE } from "./skill-artifact-ignore";
import { taskDir } from "./task-dir-utils";

/**
 * What a task's file index never tracks, declared as bare directory and file
 * names. Names rather than patterns because the consumers below do not share a
 * pattern dialect, and a name is the one form each of them can spell correctly.
 * Every name means "wherever this appears in the tree", never just at the task
 * root: the trees that matter sit deeper (`work/.venv`,
 * `work/skills/<source>/<name>/node_modules`).
 *
 * Add to this list, not to the derived ones.
 */
const EXCLUDED_NAMES = [
  ".git",
  // Dependency trees and tool caches: thousands of machine-generated entries
  // (a Python venv alone runs to hundreds, and past the index's file cap once
  // it holds the scientific stack) that would bury the task's own files in the
  // index and drown the per-turn change list the user reads.
  ...SKILL_ARTIFACT_IGNORE,
  // The private dir holds the db, settings, and the browser session/home -- all
  // hidden from the agent file index (and off-limits to agent reads entirely).
  TASK_FOLDER_NAMES.private,
  // Tool-output spill logs live under work/ so the agent can read the paths it
  // is handed, but they are noise for the user, so keep them out of the index.
  TASK_FOLDER_NAMES.toolOutput,
  // Legacy `.state` runtime dir (screenshots/bash-output). Not migrated -- the
  // db references its paths -- so keep it hidden from the index for old tasks.
  ".state",
  // Generated lockfile (rewritten by every pnpm install, incl. inside loaded
  // skills). Never read or hand-edited. We do not ignore pnpm-workspace.yaml: it
  // is real, occasionally agent-edited config that should stay enumerated and
  // surface in chat when changed.
  "pnpm-lock.yaml",
];

/**
 * The two renderings are branded because they are both `string[]` holding
 * similar-looking globs, and handing one to the other's library is silent: the
 * patterns simply stop matching, and paths meant to be excluded quietly flow
 * through. The brands make that a type error wherever a consumer names which
 * dialect it speaks.
 */
const GitignorePatternsSchema = z.array(z.string()).brand("GitignorePatterns");
const WatcherPatternsSchema = z.array(z.string()).brand("WatcherPatterns");

/** Patterns in @parcel/watcher syntax, for its `ignore` option. */
export type WatcherPatterns = z.output<typeof WatcherPatternsSchema>;

/**
 * {@link EXCLUDED_NAMES} in gitignore syntax, for the `ignore` package: a bare
 * name there already matches at every depth, so the name and a recursive glob
 * for its contents are all that is needed.
 */
const INTERNAL_IGNORE_PATTERNS = GitignorePatternsSchema.parse(
  EXCLUDED_NAMES.flatMap((name) => [name, `${name}/**`]),
);

/**
 * {@link EXCLUDED_NAMES} in @parcel/watcher syntax, which is not gitignore
 * syntax: it resolves a bare name against the watched root, so that form only
 * matches at the top level, and it anchors a `name/**` glob to the start of the
 * path. The depth-anchored spellings are what actually reach `work/.venv` and a
 * skill's `node_modules`.
 *
 * `**\/name` earns its place alongside `**\/name/**`: the native backends test a
 * directory before deciding whether to descend, and on Linux each directory they
 * do descend into costs an inotify watch descriptor -- a finite per-user
 * resource that a venv plus a few skills' dependencies can plausibly exhaust,
 * after which the watcher silently stops seeing changes.
 */
export const WATCHER_IGNORE_PATTERNS = WatcherPatternsSchema.parse(
  EXCLUDED_NAMES.flatMap((name) => [
    name,
    `${name}/**`,
    `**/${name}`,
    `**/${name}/**`,
  ]),
);

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

// While walking a live tree, a path can disappear between its parent's readdir
// and the moment we touch it -- routine when the tree is being rewritten under
// us (a failed clone getting cleaned up, a checkout aborting). Treat these
// codes as "the entry is gone" and skip it rather than aborting the whole walk.
function isVanishedPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
// Reads a directory, tolerating a subtree that vanished mid-walk (returns null
// to skip it). The task root going missing is a real error and still throws.
async function readDirEntries(
  absoluteDir: string,
  { isRoot }: { isRoot: boolean },
) {
  try {
    return await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (isRoot || !isVanishedPathError(error)) {
      throw error;
    }
    return null;
  }
}
// lstats a walked entry, tolerating a file deleted between the readdir above
// and now (returns null to skip it). Other errors still abort the walk.
async function statEntry(absolutePath: string) {
  try {
    return await fs.lstat(absolutePath);
  } catch (error) {
    if (isVanishedPathError(error)) {
      return null;
    }
    throw error;
  }
}

const TaskFileIndexEntrySchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  mtimeMs: z.number(),
  size: z.number(),
});

export type TaskFileIgnore = Awaited<ReturnType<typeof getTaskFileIgnore>>;

type TaskFileEntry = z.output<typeof TaskFileIndexEntrySchema>;

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

/**
 * The matcher deciding what the task's file index tracks: the task's own
 * .gitignore plus the internal exclusions. Shared so the index, the watcher, and
 * a persisted baseline all agree on which paths exist -- a baseline judged by a
 * narrower list than the index it is diffed against turns every path the index
 * newly skips into a phantom deletion.
 */
export async function getTaskFileIgnore(
  dir: TaskDir,
  { signal }: { signal?: AbortSignal } = {},
) {
  const ignore = await getIgnore(dir, { signal });
  return ignore.add(INTERNAL_IGNORE_PATTERNS);
}

export async function getTaskFileIndex(
  dir: TaskDir,
  {
    maxFiles = MAX_TASK_FILE_INDEX_FILES,
    signal,
  }: { maxFiles?: number; signal?: AbortSignal } = {},
) {
  try {
    const ignore = await getTaskFileIgnore(dir, { signal });

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
      const entries = await readDirEntries(absoluteDir, {
        isRoot: !relativeDir,
      });
      if (!entries) {
        return;
      }

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

        if (isIgnoredTaskPath(ignore, relativePath)) {
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

        const stats = await statEntry(absolutePath);
        if (!stats || !stats.isFile()) {
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

/**
 * True when the path is one the task's file index deliberately does not track.
 * Tests the directory spelling too, so a pattern written for a directory matches
 * the directory itself and not only its contents.
 */
export function isIgnoredTaskPath(
  ignore: TaskFileIgnore,
  relativePath: string,
) {
  return ignore.ignores(relativePath) || ignore.ignores(`${relativePath}/`);
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
