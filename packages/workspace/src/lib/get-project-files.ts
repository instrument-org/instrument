import { err, ok } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { APP_FOLDER_NAMES } from "../constants";
import { type AppDir, RelativePathSchema } from "../schemas/paths";
import { type ProjectSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { createAppConfig } from "./app-config/create";
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
];

const ProjectFileSchema = z.object({
  filename: z.string(),
  filePath: RelativePathSchema,
  mimeType: z.string(),
  size: z.number(),
});

export const ProjectFilesSchema = z.array(ProjectFileSchema);

export const MAX_PROJECT_FILE_INDEX_FILES = 5000;

export type ProjectFile = z.output<typeof ProjectFileSchema>;
export interface ProjectFileChange extends ProjectFile {
  status: "added" | "deleted" | "modified";
}
export type ProjectFileIndex = Map<string, ProjectFileEntry>;
type ProjectFileEntry = ProjectFile & {
  mtimeMs: number;
};

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
      changes.push({ ...withoutMtime(file), status: "added" });
      continue;
    }

    if (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
      changes.push({ ...withoutMtime(file), status: "modified" });
    }
  }

  for (const [filePath, file] of before) {
    if (after.has(filePath)) {
      continue;
    }
    changes.push({ ...withoutMtime(file), status: "deleted" });
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

        const filePath = RelativePathSchema.parse(`./${relativePath}`);
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

export async function getProjectFiles(
  projectSubdomain: ProjectSubdomain,
  workspaceConfig: WorkspaceConfig,
) {
  const projectConfig = createAppConfig({
    subdomain: projectSubdomain,
    workspaceConfig,
  });

  const indexResult = await getProjectFileIndex(projectConfig.appDir);
  if (indexResult.isErr()) {
    return err(indexResult.error);
  }

  return ok(projectFilesFromIndex(indexResult.value));
}

export function outputArtifactPathsFromChanges(changes: ProjectFileChange[]) {
  return changes
    .filter(
      (change) =>
        change.status !== "deleted" &&
        change.filePath.startsWith(`./${APP_FOLDER_NAMES.output}/`),
    )
    .map((change) => change.filePath.slice(2))
    .sort((a, b) => a.localeCompare(b));
}

export function projectFilesFromIndex(index: ProjectFileIndex): ProjectFile[] {
  return [...index.values()]
    .map(({ mtimeMs: _mtimeMs, ...file }) => file)
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function withoutMtime({
  mtimeMs: _mtimeMs,
  ...file
}: ProjectFileEntry): z.output<typeof ProjectFileSchema> {
  return file;
}
