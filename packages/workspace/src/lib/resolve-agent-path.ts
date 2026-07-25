import { ok } from "neverthrow";
import { accessSync, constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
} from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { ensureRelativePath } from "./ensure-relative-path";
import { executeError } from "./execute-error";
import { normalizePath } from "./normalize-path";
import { pathExists } from "./path-exists";
import { pathIsWithin } from "./path-is-within";
import { resolvePathWithinTaskDir } from "./resolve-path-within-task-dir";
import {
  hostPathEscapesMount,
  nonTaskMounts,
  resolveHostPath,
  TASK_MOUNT_POINT,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

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
  displayPath,
}: {
  absolutePath: AbsolutePath;
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
      .map((entry) =>
        normalizePath(path.join(path.dirname(displayPath), entry)),
      )
      .slice(0, 3);

    return suggestions;
  } catch {
    return [];
  }
}

/**
 * Resolve a read-path input against the workspace layout. Accepts task-relative
 * paths, the task's own virtual paths (/task/...), attached-folder mount paths
 * (/mnt/<name>/...), the workspace skills mount (/skills/...), and the
 * connectors mount (/connectors/...). Any other absolute path is an error that
 * steers the agent back into the layout.
 *
 * Returns `{ absolutePath, displayPath, mount }`:
 * - `absolutePath` — real host path; use for all file I/O.
 * - `displayPath` — what to echo back to the agent: task-relative for the task
 *   (./work/...), the virtual mount path everywhere else (/mnt/..., /skills/...,
 *   /connectors/...).
 * - `mount` — the non-task mount that owns the path, or null when the path is in
 *   the task. Callers that emit host paths (glob/grep results) must map them
 *   back through resolveVirtualPath when this is set.
 */
export function resolveAgentPath(options: {
  inputPath?: string;
  isRequired?: boolean;
  layout: WorkspaceFsLayout;
}) {
  const { inputPath, isRequired = true, layout } = options;

  if (!inputPath?.trim()) {
    if (!isRequired) {
      return ok({
        absolutePath: layout.task.hostRoot,
        displayPath: "./",
        mount: null,
      });
    }
    return executeError("Path is required but was not provided");
  }

  const trimmedPath = inputPath.trim();
  if (path.isAbsolute(trimmedPath)) {
    return resolveVirtualAbsolutePath(layout, trimmedPath);
  }

  const result = resolveToolPath(layout, trimmedPath);
  if (result.isErr()) {
    return result;
  }
  return ok({ ...result.value, mount: null });
}

/**
 * Resolves an agent path and applies Unicode fallbacks for existing-file
 * lookups. Use this instead of resolveAgentPath when the path must refer to
 * an already-existing file (read, edit). Do not use for writes/creates.
 */
export function resolveExistingFilePath(options: {
  inputPath?: string;
  layout: WorkspaceFsLayout;
}) {
  const result = resolveAgentPath({ ...options, isRequired: true });
  if (result.isErr()) {
    return result;
  }
  return ok({
    ...result.value,
    absolutePath: applyUnicodeFallbacks(result.value.absolutePath),
  });
}

/**
 * Resolve a raw agent-provided path to a validated absolute path within the
 * task directory, plus the normalized display path. Rewrites sloppy input
 * ("work/x", "/work/x") into task-relative form and rejects traversal out of
 * the task, including Windows-style "./subdir\\..\\.." on all platforms.
 *
 * This is the relative-only resolver: virtual absolute paths (/task, /mnt)
 * never reach it from resolveAgentPath/resolveWritableToolPath, which
 * pre-handle them against the layout.
 */
export function resolveToolPath(layout: WorkspaceFsLayout, inputPath: string) {
  const fixedPathResult = ensureRelativePath(inputPath);
  if (fixedPathResult.isErr()) {
    return fixedPathResult;
  }
  const displayPath = fixedPathResult.value;

  const absolutePath = resolvePathWithinTaskDir({
    dir: layout.task.hostRoot,
    filePath: displayPath,
  });
  if (!absolutePath) {
    return executeError(`Path escapes the task directory: ${inputPath}`);
  }
  if (hostPathEscapesMount(absolutePath, layout.task.hostRoot)) {
    return executeError(
      `The path "${inputPath}" resolves outside its mount (via a symlink) and cannot be accessed.`,
    );
  }

  if (isTaskPrivatePath(layout.task.hostRoot, absolutePath)) {
    return privateDirError(displayPath);
  }

  return ok({ absolutePath, displayPath });
}

/**
 * Resolve a write-path input against the workspace layout. Task-relative paths,
 * the task's own virtual paths (/task/...), and the writable workspace mounts
 * (/skills/..., /connectors/...) resolve normally; read-only mounts are rejected
 * with copy-into-task guidance instead of silently landing somewhere else.
 * Whether a non-task mount is writable is decided by its readOnly flag, never by
 * a per-mount special case here.
 */
export function resolveWritableToolPath(options: {
  inputPath: string;
  layout: WorkspaceFsLayout;
}) {
  const { inputPath, layout } = options;
  const trimmedPath = inputPath.trim();

  if (!path.isAbsolute(trimmedPath)) {
    return resolveToolPath(layout, trimmedPath);
  }

  const result = resolveVirtualAbsolutePath(layout, trimmedPath);
  if (result.isErr()) {
    return result;
  }
  const { absolutePath, displayPath, mount } = result.value;
  if (mount?.readOnly) {
    return executeError(
      `"${displayPath}" is in a read-only attached folder and cannot be written. ` +
        `Copy the file into the task first (e.g. cp '${displayPath}' attachments/) and work on the copy.`,
    );
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

// The private dir (.instrument) holds task internals -- the task db, state.json
// (attached-folder host paths), and settings -- that the agent must never read
// through the file tools. Agent-facing byproducts live under work/ instead.
function isTaskPrivatePath(
  taskHostRoot: AbsolutePath,
  hostPath: string,
): boolean {
  const privateDir = absolutePathJoin(taskHostRoot, TASK_FOLDER_NAMES.private);
  return hostPath === privateDir || pathIsWithin(hostPath, privateDir);
}

function privateDirError(displayPath: string) {
  return executeError(
    `"${displayPath}" is inside the private ${TASK_FOLDER_NAMES.private} ` +
      `directory, which holds task internals and is not accessible. Agent ` +
      `outputs like screenshots and tool-output logs live under work/.`,
  );
}

/**
 * Resolve an absolute virtual path (/task/..., /mnt/<name>/..., /skills/...,
 * /connectors/...) through the layout. Absolute paths outside every mount error
 * with steering:
 * real host paths into a mounted directory point at that mount's virtual path,
 * and anything else lists what the layout actually exposes.
 */
function resolveVirtualAbsolutePath(
  layout: WorkspaceFsLayout,
  virtualPath: string,
) {
  const resolved = resolveHostPath(layout, virtualPath);

  if (resolved === null) {
    const mounts = nonTaskMounts(layout);
    // The agent passed a real host path that points into a mounted directory.
    // Steer it to the mount path instead of leaking host paths around.
    const owner = mounts.find((mount) =>
      pathIsWithin(virtualPath, mount.hostRoot),
    );
    if (owner) {
      return executeError(
        `The path "${virtualPath}" is a mounted folder's real location on disk. ` +
          `Use its mount path "${owner.mountPoint}/..." instead.`,
      );
    }
    const mountHint =
      mounts.length > 0
        ? `, or a mount path (${mounts.map((mount) => mount.mountPoint).join(", ")})`
        : "";
    return executeError(
      `The absolute path "${virtualPath}" is outside the task. ` +
        `Use a task-relative path (or ${TASK_MOUNT_POINT}/...)${mountHint}.`,
    );
  }

  const { hostPath, mount } = resolved;

  // Dedicated file tools use node fs directly, so enforce the same symlink
  // boundary as the bash sandbox for every mount, including writable ones.
  if (hostPathEscapesMount(hostPath, mount.hostRoot)) {
    return executeError(
      `The path "${virtualPath}" resolves outside its mount (via a symlink) and cannot be accessed.`,
    );
  }

  if (mount === layout.task) {
    if (isTaskPrivatePath(layout.task.hostRoot, hostPath)) {
      return privateDirError(normalizePath(virtualPath));
    }
    // Normalize /task/... input into the same task-relative form as relative
    // input so display paths stay consistent across tools.
    const normalized = normalizePath(virtualPath);
    const relative =
      normalized === TASK_MOUNT_POINT
        ? "./"
        : `./${normalized.slice(TASK_MOUNT_POINT.length + 1)}`;
    return ok({
      absolutePath: hostPath,
      displayPath: RelativePathSchema.parse(relative),
      mount: null,
    });
  }

  return ok({
    absolutePath: hostPath,
    displayPath: normalizePath(virtualPath),
    mount,
  });
}
