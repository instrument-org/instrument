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
import { pathExists } from "./path-exists";
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

/**
 * {@link EXCLUDED_NAMES} in gitignore syntax, for the `ignore` package: a bare
 * name there already matches at every depth, so the name and a recursive glob
 * for its contents are all that is needed.
 */
const INTERNAL_IGNORE_PATTERNS = GitignorePatternsSchema.parse(
  EXCLUDED_NAMES.flatMap((name) => [name, `${name}/**`]),
);

const TaskFileSchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  modifiedAt: z.number(),
  size: z.number(),
});

export const TaskFilesSchema = z.array(TaskFileSchema);

const MAX_TASK_FILE_INDEX_FILES = 5000;

export type TaskFile = z.output<typeof TaskFileSchema>;

export type TaskFileIndex = Map<string, TaskFileEntry>;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

// An entry the process may not look at: a mode the agent set on a directory it
// made, or one restored from an archive that carried its permissions. The index
// is a best-effort view of what is on disk, so one closed door hides its own
// subtree rather than emptying the whole panel.
function isUnreadablePathError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EPERM";
}
// While walking a live tree, a path can disappear between its parent's readdir
// and the moment we touch it -- routine when the tree is being rewritten under
// us (a failed clone getting cleaned up, a checkout aborting). Treat these
// codes as "the entry is gone" and skip it rather than aborting the whole walk.
function isVanishedPathError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}
// Reads a directory, tolerating a subtree that vanished or cannot be read
// (returns null to skip it). The task root is the walk itself and still throws.
async function readDirEntries(
  absoluteDir: string,
  { isRoot }: { isRoot: boolean },
) {
  try {
    return await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (
      isRoot ||
      !(isVanishedPathError(error) || isUnreadablePathError(error))
    ) {
      throw error;
    }
    return null;
  }
}
// lstats a walked entry, tolerating one deleted between the readdir above and
// now, or sitting somewhere we may not look (returns null to skip it). Other
// errors still abort the walk.
async function statEntry(absolutePath: string) {
  try {
    return await fs.lstat(absolutePath);
  } catch (error) {
    if (isVanishedPathError(error) || isUnreadablePathError(error)) {
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
        // normalizePath) can collapse into a traversal path that escapes dir,
        // or into one that reads as absolute -- `\logs\out.txt` is a single
        // legal name on macOS and Linux, and the kind of thing an agent writes
        // when it spells a path the Windows way. Skip both here: the ignore
        // matcher throws on an absolute path, and neither shape names a file
        // the index can address.
        const filePath = RelativePathSchema.safeParse(relativePath);
        if (
          !filePath.success ||
          relativePath === ".." ||
          relativePath.startsWith("../")
        ) {
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

        files.push({
          filename: path.basename(relativePath),
          filePath: filePath.data,
          mimeType: getMimeType(relativePath),
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        });
      }
    }

    await walk("");

    return ok(new Map(files.map((file) => [file.filePath, file])));
  } catch (error) {
    // A task whose directory is gone is not a failure to report: the user
    // trashed it, and whatever is still asking for its files is on its way to
    // unmounting. Every other throw is real, and names what it was -- the
    // errno, or the class for a throw that carries none -- because the message
    // alone is the same sentence for a permission error, an unreadable
    // .gitignore, and a disk that went away.
    if (isVanishedPathError(error) && !(await pathExists(dir))) {
      return err(new TypedError.NotFound(`No directory for task at ${dir}`));
    }

    return err(
      new TypedError.FileSystem(
        `Error listing task files (${errorCode(error) ?? describeThrown(error)})`,
        { cause: error },
      ),
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

// The class of a throw carrying no errno, for the message above. Not the
// value's own text, which for an fs error holds the path it failed on: this is
// the one message here that reaches telemetry.
function describeThrown(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/**
 * The matcher deciding what the task's file index tracks: the task's own
 * .gitignore plus the internal exclusions. Shared so the index, the watcher, and
 * a persisted baseline all agree on which paths exist -- a baseline judged by a
 * narrower list than the index it is diffed against turns every path the index
 * newly skips into a phantom deletion.
 */
async function getTaskFileIgnore(
  dir: TaskDir,
  { signal }: { signal?: AbortSignal } = {},
) {
  const ignore = await getIgnore(dir, { signal });
  return ignore.add(INTERNAL_IGNORE_PATTERNS);
}

/**
 * True when the path is one the task's file index deliberately does not track.
 * Tests the directory spelling too, so a pattern written for a directory matches
 * the directory itself and not only its contents.
 */
function isIgnoredTaskPath(ignore: TaskFileIgnore, relativePath: string) {
  return ignore.ignores(relativePath) || ignore.ignores(`${relativePath}/`);
}

function taskFilesFromIndex(index: TaskFileIndex): TaskFile[] {
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
