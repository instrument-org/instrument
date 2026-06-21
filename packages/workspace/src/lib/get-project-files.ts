import { PROJECT_MANIFEST_FILE_NAME } from "@instrument-org/shared";
import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { APP_FOLDER_NAMES } from "../constants";
import { type AppDir, RelativePathSchema } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { absolutePathJoin } from "./absolute-path-join";
import { createAppConfig } from "./app-config/create";
import { taskDir } from "./app-dir-utils";
import { TypedError } from "./errors";
import { getIgnore } from "./get-ignore";
import { getMimeType } from "./get-mime-type";
import { normalizePath } from "./normalize-path";

export const INTERNAL_IGNORE_PATTERNS = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  APP_FOLDER_NAMES.private,
  `${APP_FOLDER_NAMES.private}/**`,
  APP_FOLDER_NAMES.state,
  `${APP_FOLDER_NAMES.state}/**`,
  APP_FOLDER_NAMES.tmp,
  `${APP_FOLDER_NAMES.tmp}/**`,
  PROJECT_MANIFEST_FILE_NAME,
  // Generated lockfile (rewritten by every pnpm install, incl. inside loaded
  // skills). Never read or hand-edited; bare name matches at any depth. We do
  // not ignore pnpm-workspace.yaml: it is real, occasionally agent-edited config
  // that should stay enumerated and surface in chat when changed.
  "pnpm-lock.yaml",
];

const ProjectFileSchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  modifiedAt: z.number(),
  size: z.number(),
});

export const ProjectFilesSchema = z.array(ProjectFileSchema);

export const MAX_PROJECT_FILE_INDEX_FILES = 5000;

export type ProjectFile = z.output<typeof ProjectFileSchema>;
export type ProjectFileChange = ProjectFile & {
  status: "added" | "deleted" | "modified";
};
export type ProjectFileIndex = Map<string, ProjectFileEntry>;

const ProjectFileIndexEntrySchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  mtimeMs: z.number(),
  size: z.number(),
});

type ProjectFileEntry = z.output<typeof ProjectFileIndexEntrySchema>;

// Serializable form of the index, used to persist a baseline across turns.
export const ProjectFileIndexSnapshotSchema = z.array(
  ProjectFileIndexEntrySchema,
);

export function diffProjectFileIndexes({
  after,
  before,
}: {
  after: ProjectFileIndex;
  before: ProjectFileIndex;
}): ProjectFileChange[] {
  const changes: ProjectFileChange[] = [];

  for (const [filePath, file] of after) {
    const previous = before.get(filePath);
    if (!previous) {
      changes.push({ ...toProjectFile(file), status: "added" });
      continue;
    }

    if (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
      changes.push({ ...toProjectFile(file), status: "modified" });
    }
  }

  for (const [filePath, file] of before) {
    if (after.has(filePath)) {
      continue;
    }
    changes.push({ ...toProjectFile(file), status: "deleted" });
  }

  return changes.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export async function getProjectFileIndex(
  appDir: AppDir,
  {
    maxFiles = MAX_PROJECT_FILE_INDEX_FILES,
    signal,
  }: { maxFiles?: number; signal?: AbortSignal } = {},
) {
  try {
    const ignore = await getIgnore(appDir, { signal });
    ignore.add(INTERNAL_IGNORE_PATTERNS);

    const files: ProjectFileEntry[] = [];
    let reachedFileLimit = false;

    async function walk(relativeDir: string) {
      signal?.throwIfAborted();
      if (reachedFileLimit) {
        return;
      }

      const absoluteDir = relativeDir
        ? absolutePathJoin(appDir, relativeDir)
        : appDir;
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
        // appDir. Skip rather than letting lstat throw and abort the walk.
        if (relativePath === ".." || relativePath.startsWith("../")) {
          continue;
        }

        if (
          ignore.ignores(relativePath) ||
          ignore.ignores(`${relativePath}/`)
        ) {
          continue;
        }

        const absolutePath = absolutePathJoin(appDir, relativePath);

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

export async function getProjectFiles(projectSubdomain: ProjectSubdomain) {
  const projectConfig = createAppConfig({ subdomain: projectSubdomain });

  const indexResult = await getProjectFileIndex(taskDir(projectConfig));
  if (indexResult.isErr()) {
    return err(indexResult.error);
  }

  return ok(projectFilesFromIndex(indexResult.value));
}

export function outputArtifactsFromChanges(changes: ProjectFileChange[]) {
  return changes
    .filter(
      (change) =>
        change.status !== "deleted" &&
        change.filePath.startsWith(`${APP_FOLDER_NAMES.output}/`),
    )
    .map(({ filePath, modifiedAt }) => ({ filePath, modifiedAt }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function projectFileIndexFromSnapshot(
  snapshot: ProjectFileEntry[],
): ProjectFileIndex {
  return new Map(snapshot.map((entry) => [entry.filePath, entry]));
}

export function projectFileIndexToSnapshot(
  index: ProjectFileIndex,
): ProjectFileEntry[] {
  return [...index.values()];
}

export function projectFilesFromIndex(index: ProjectFileIndex): ProjectFile[] {
  return [...index.values()]
    .map(toProjectFile)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function toProjectFile({ mtimeMs, ...file }: ProjectFileEntry): ProjectFile {
  return {
    ...file,
    modifiedAt: mtimeMs,
  };
}
