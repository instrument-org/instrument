import { exec } from "dugite";
import nodeIgnore from "ignore";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { RelativePathSchema, type TaskDir } from "../schemas/paths";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessageRelaxedPart } from "../schemas/session/message-relaxed-part";
import { getMimeType } from "./get-mime-type";
import { INTERNAL_IGNORE_PATTERNS } from "./get-task-files";
import { normalizePath } from "./normalize-path";

// cspell:ignore quotepath NOSYSTEM

const GitCommitDataSchema = z.object({
  ref: z.string(),
});

// git diff-tree --name-status outputs lines like: "M\tpath/to/file"
// The first character is the status letter.
const GIT_STATUS_MAP: Partial<
  Record<string, SessionMessageDataPart.FileChangeDataPartItem["status"]>
> = {
  A: "added",
  D: "deleted",
  M: "modified",
};

// A ref's tree is immutable, so resolving the same (dir, ref) twice yields
// the same files. Memoize the in-flight promise to dedupe the concurrent calls
// store.ts fires per message and to avoid re-spawning git on repeated views.
const fileChangesCache = new Map<
  string,
  Promise<null | SessionMessageDataPart.FileChangeDataPartItem[]>
>();

/**
 * Best-effort translation of a legacy `data-gitCommit` part to a
 * `data-fileChanges` part.  Called at load time so no data ever needs to be
 * re-saved.  Returns `null` when the migration is not possible (git history
 * unavailable, no files resolved, etc.), in which case the caller should drop
 * the part.
 */
export async function migrateGitCommitPart(
  part: SessionMessageRelaxedPart.DataPart,
  dir: TaskDir,
): Promise<null | SessionMessageRelaxedPart.DataPart> {
  const parseResult = GitCommitDataSchema.safeParse(part.data);
  if (!parseResult.success) {
    return null;
  }

  const files = await resolveFileChanges(dir, parseResult.data.ref);
  if (!files) {
    return null;
  }

  return {
    ...part,
    data: { files } satisfies SessionMessageDataPart.FileChangesDataPart,
    type: "data-fileChanges",
  };
}

function resolveFileChanges(dir: TaskDir, ref: string) {
  const cacheKey = `${dir}\0${ref}`;
  const cached = fileChangesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = resolveFileChangesUncached(dir, ref);
  fileChangesCache.set(cacheKey, promise);
  return promise;
}

async function resolveFileChangesUncached(
  dir: TaskDir,
  ref: string,
): Promise<null | SessionMessageDataPart.FileChangeDataPartItem[]> {
  try {
    const result = await exec(
      [
        // core.quotepath=false keeps non-ASCII filenames (e.g. the U+202F in
        // macOS screenshot names) raw instead of octal-escaped + quoted, so
        // they parse and stat correctly on every OS.
        "-c",
        "core.quotepath=false",
        "diff-tree",
        "--no-commit-id",
        // --root handles the edge case of the very first commit having no parent.
        "--root",
        "-r",
        "--name-status",
        // --end-of-options guards against a ref that looks like a flag.
        "--end-of-options",
        ref,
      ],
      dir,
      {
        // Ignore the user/system git config so diff-tree output is deterministic.
        env: { GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" },
        signal: AbortSignal.timeout(5000),
      },
    );

    // dugite only rejects when git fails to launch; a bad ref resolves with a
    // non-zero exit code, so check it explicitly and drop the part.
    if (result.exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.warn("[migrate-git-commit-part] git diff-tree failed", {
        dir,
        exitCode: result.exitCode,
        ref,
        stderr: result.stderr,
      });
      return null;
    }

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const ignore = nodeIgnore().add(INTERNAL_IGNORE_PATTERNS);
    const files: SessionMessageDataPart.FileChangeDataPartItem[] = [];

    for (const line of lines) {
      const [statusChar, rawPath] = line.split("\t");
      if (!rawPath || !statusChar) {
        continue;
      }

      const status = GIT_STATUS_MAP[statusChar.charAt(0)];
      if (!status) {
        continue;
      } // skip renames, copies, etc.

      const normalizedRelPath = normalizePath(rawPath);
      if (ignore.ignores(normalizedRelPath)) {
        continue;
      }

      const filePathResult = RelativePathSchema.safeParse(normalizedRelPath);
      if (!filePathResult.success) {
        continue;
      }

      let size = 0;
      let modifiedAt = 0;

      if (status !== "deleted") {
        try {
          const stat = await fs.stat(path.join(dir, normalizedRelPath));
          size = stat.size;
          modifiedAt = stat.mtimeMs;
        } catch {
          // File no longer exists on disk; leave size/modifiedAt at 0.
          // FileChangesCard already filters these out.
        }
      }

      files.push({
        filename: path.basename(normalizedRelPath),
        filePath: filePathResult.data,
        mimeType: getMimeType(normalizedRelPath),
        modifiedAt,
        size,
        status,
      });
    }

    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[migrate-git-commit-part] no files found for ref", {
        dir,
        ref,
      });
      return null;
    }

    // eslint-disable-next-line no-console
    console.log(
      "[migrate-git-commit-part] translated gitCommit to fileChanges",
      { dir, fileCount: files.length, ref },
    );

    return files;
  } catch (error) {
    // git failed to launch or the 5s timeout fired; drop the part
    // eslint-disable-next-line no-console
    console.warn(
      "[migrate-git-commit-part] failed to migrate gitCommit part",
      { dir, ref },
      error,
    );
    return null;
  }
}
