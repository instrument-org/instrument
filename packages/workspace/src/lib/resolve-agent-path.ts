import {
  ok,
} from "neverthrow";
import {
  accessSync,
  constants,
} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type AgentName,
  RETRIEVAL_AGENT_NAME,
} from "../agents/types";
import {
  type FolderAttachment,
} from "../schemas/folder-attachment";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  type TaskDir,
} from "../schemas/paths";
import {
  Task,
} from "../tools/task";
import {
  ensureRelativePath,
} from "./ensure-relative-path";
import {
  executeError,
} from "./execute-error";
import {
  normalizePath,
} from "./normalize-path";
import {
  pathExists,
} from "./path-exists";
import {
  resolvePathWithinTaskDir,
} from "./resolve-path-within-app-dir";
import {
  validateAttachedFolderPath,
} from "./validate-attached-folder-path";

const NARROW_NO_BREAK_SPACE = "\u202F";

/**
 * Applies macOS-specific Unicode filename fallbacks to find an existing file.
 * macOS screenshots use U+202F (narrow no-break space) before AM/PM, store
 * filenames in NFD form, and use U+2019 (curly apostrophe) in French names.
 * Returns the resolved path if a variant exists, otherwise the original.
 *
 * Adapted from https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/path-utils.ts
 */
export function applyUnicodeFallbacks(
  resolvedPath: AbsolutePath,
): AbsolutePath {
  if (fileExistsSync(resolvedPath)) {
    return resolvedPath;
  }

  // macOS screenshots: narrow no-break space before AM/PM
  const amPmVariant = resolvedPath.replaceAll(
    / (AM|PM)\./g,
    `${NARROW_NO_BREAK_SPACE}$1.`,
  );
  if (amPmVariant !== resolvedPath && fileExistsSync(amPmVariant)) {
    return AbsolutePathSchema.parse(amPmVariant);
  }

  // macOS stores filenames in NFD (decomposed) form
  const nfdVariant = resolvedPath.normalize("NFD");
  if (nfdVariant !== resolvedPath && fileExistsSync(nfdVariant)) {
    return AbsolutePathSchema.parse(nfdVariant);
  }

  // macOS uses U+2019 (right single quotation mark) in screenshot names
  const curlyVariant = resolvedPath.replaceAll("'", "\u2019");
  if (curlyVariant !== resolvedPath && fileExistsSync(curlyVariant)) {
    return AbsolutePathSchema.parse(curlyVariant);
  }

  // cspell:ignore d'écran
  // Combined NFD + curly quote (e.g. French macOS: "Capture d'écran")
  const nfdCurlyVariant = nfdVariant.replaceAll("'", "\u2019");
  if (nfdCurlyVariant !== resolvedPath && fileExistsSync(nfdCurlyVariant)) {
    return AbsolutePathSchema.parse(nfdCurlyVariant);
  }

  return resolvedPath;
}

export async function getSimilarPathSuggestions({
  absolutePath,
  agentName,
  displayPath,
}: {
  absolutePath: AbsolutePath;
  agentName: AgentName;
  displayPath: string;
}) {
  try {
    const dir = path.dirname(absolutePath);
    const dirAsAbsolute = AbsolutePathSchema.parse(dir);
    const dirExists = await pathExists(dirAsAbsolute);

    if (!dirExists) {
      return [];
    }

    const base = path.basename(absolutePath);
    const baseWithoutExt = path.parse(base).name;
    const dirEntries = await fs.readdir(dir);

    const suggestions = dirEntries
      .filter((entry) => {
        const entryWithoutExt = path.parse(entry).name;
        return (
          entry.toLowerCase().includes(base.toLowerCase()) ||
          base.toLowerCase().includes(entry.toLowerCase()) ||
          entryWithoutExt.toLowerCase() === baseWithoutExt.toLowerCase()
        );
      })
      .map((entry) => {
        if (agentName === "retrieval") {
          // For retrieval agent, return absolute paths
          return path.join(dir, entry);
        }
        // For normal agent, return relative paths
        return normalizePath(path.join(path.dirname(displayPath), entry));
      })
      .slice(0, 3);

    return suggestions;
  } catch {
    return [];
  }
}

export function resolveAgentPath(options: {
  agentName: AgentName;
  attachedFolders?: Record<string, FolderAttachment.Type>;
  dir: TaskDir;
  inputPath?: string;
  isRequired?: boolean;
}) {
  const {
    agentName,
    attachedFolders,
    dir,
    inputPath,
    isRequired = true,
  } = options;

  // Retrieval agent ALWAYS requires a path - it cannot operate in the current folder
  if (agentName === "retrieval") {
    if (!inputPath?.trim()) {
      const folderList = attachedFolders
        ? Object.values(attachedFolders)
            .map((f) => `  - ${f.name}: ${f.path}`)
            .join("\n")
        : "";
      const message = folderList
        ? `Must specify a path parameter. Available folders:\n${folderList}`
        : "Must specify an absolute path to an attached folder";
      return executeError(message);
    }

    const trimmedPath = inputPath.trim();
    const pathResult = attachedFolders
      ? validateAttachedFolderPath(trimmedPath, attachedFolders)
      : executeError("No attached folders available");

    if (pathResult.isErr()) {
      return pathResult;
    }
    return ok({
      absolutePath: pathResult.value,
      displayPath: trimmedPath,
    });
  }

  // Non-retrieval agents: handle optional paths
  if (!inputPath?.trim()) {
    if (!isRequired) {
      return ok({
        absolutePath: dir,
        displayPath: "./",
      });
    }
    return executeError("Path is required but was not provided");
  }

  const trimmedPath = inputPath.trim();

  if (path.isAbsolute(trimmedPath) && attachedFolders) {
    const matchingFolder = Object.values(attachedFolders).find((folder) =>
      trimmedPath.startsWith(folder.path),
    );
    if (matchingFolder) {
      return executeError(
        `The path "${trimmedPath}" is within the attached folder "${matchingFolder.name}". ` +
          `Use the ${Task.name} tool with subagent_type "${RETRIEVAL_AGENT_NAME}" to access files from attached folders.`,
      );
    }
  }

  return resolveToolPath(dir, trimmedPath);
}

/**
 * Resolves an agent path and applies Unicode fallbacks for existing-file
 * lookups. Use this instead of resolveAgentPath when the path must refer to
 * an already-existing file (read, edit). Do not use for writes/creates.
 */
export function resolveExistingFilePath(options: {
  agentName: AgentName;
  attachedFolders?: Record<string, FolderAttachment.Type>;
  dir: TaskDir;
  inputPath?: string;
}) {
  const result = resolveAgentPath({ ...options, isRequired: true });
  if (result.isErr()) {
    return result;
  }
  const { absolutePath, displayPath } = result.value;
  return ok({
    absolutePath: applyUnicodeFallbacks(absolutePath),
    displayPath,
  });
}

/**
 * Resolves a raw agent-provided path string to a validated absolute path
 * within the task directory, plus the normalized display path.
 *
 * This is the standard entry point for every agent tool execute() function
 * that accepts a file path input. It combines:
 * 1. Format validation (ensureRelativePath) — rejects absolute paths and
 *    obviously malformed input.
 * 2. Containment check (resolvePathWithinTaskDir) — normalizes backslash
 *    separators then verifies the resolved path stays inside dir, so
 *    Windows-style traversal like "./subdir\\..\\.." is rejected on all
 *    platforms.
 *
 * Returns `{ absolutePath, displayPath }` on success:
 * - `absolutePath` — use for all file I/O operations.
 * - `displayPath` — use in tool output shown to the agent.
 *
 * For retrieval-agent / attached-folder paths use resolveAgentPath.
 * For reads where the file must already exist use resolveExistingFilePath.
 */
export function resolveToolPath(dir: TaskDir, inputPath: string) {
  const fixedPathResult = ensureRelativePath(inputPath);
  if (fixedPathResult.isErr()) {
    return fixedPathResult;
  }
  const displayPath = fixedPathResult.value;

  const absolutePath = resolvePathWithinTaskDir({
    dir,
    filePath: displayPath,
  });
  if (!absolutePath) {
    return executeError(`Path escapes the task directory: ${inputPath}`);
  }

  return ok({ absolutePath, displayPath });
}

function fileExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
