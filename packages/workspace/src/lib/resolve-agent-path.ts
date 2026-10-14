import { ok } from "neverthrow";
import { accessSync, constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../constants";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
} from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { ensureRelativePath } from "./ensure-relative-path";
import { executeError } from "./execute-error";
import { remapMovedPath } from "./moved-paths";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { pathExists } from "./path-exists";
import { reachOf } from "./permissions/rules";
import { ruleRefusal } from "./permissions/rules-fs";
import { resolvePathWithinChatDir } from "./resolve-path-within-chat-dir";
import {
  classifyHostPath,
  hostPathOf,
  resolveHostPath,
  shellPath,
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
 * Resolve a read-path input against the workspace layout. Accepts relative
 * paths and absolute paths in the shell's spelling inside any mounted folder:
 * the chat's work folder, its record folder, a folder it reaches, or a skill
 * source. Any other absolute path is an error that steers the agent toward a
 * relative path or a folder request.
 *
 * A chat's files and its records were once one folder, and a path stored
 * then is read where each went: a relative path in the work folder, or for
 * `attachments/` one missing there in the record folder; an absolute path
 * that is gone where a migration moved what held it (`remapMovedPath`).
 *
 * Returns `{ absolutePath, displayPath, mount }`:
 * - `absolutePath` — real host path; use for all file I/O.
 * - `displayPath` — what to echo back to the agent: relative for the chat's folder
 *   (./work/...), the absolute path in the shell's spelling everywhere else.
 * - `mount` — the mount other than the chat's that owns the path, or null when the
 *   path is in the chat's folder.
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
        absolutePath: layout.chat.hostRoot,
        displayPath: "./",
        mount: null,
      });
    }
    return executeError("Path is required but was not provided");
  }

  // A Windows path (`C:\Users\sam`) in the shell's spelling (`/c/Users/sam`),
  // which the layout resolves.
  const trimmedPath = shellPath(inputPath.trim());
  if (path.isAbsolute(trimmedPath)) {
    const asTyped = heldToRules(
      layout,
      resolveAbsolutePath(layout, trimmedPath),
      "read",
    );
    const hostSpelled = hostPathOf(trimmedPath);
    const remapped = remapMovedPath(hostSpelled);
    if (remapped === hostSpelled) {
      return asTyped;
    }
    // Where it went, when the agent may read it there; otherwise what the
    // path it named says, rather than one it never wrote.
    const moved = heldToRules(
      layout,
      resolveAbsolutePath(layout, shellPath(remapped)),
      "read",
    );
    return moved.isOk() ? moved : asTyped;
  }

  const result = resolveToolPath(layout, trimmedPath);
  if (result.isErr()) {
    return result;
  }
  return ok(
    attachmentInRecordFolder(layout, result.value) ?? {
      ...result.value,
      mount: null,
    },
  );
}

/**
 * A relative path under `attachments/` that the work folder does not hold,
 * as the file the person sent in the record folder, where one is there.
 */
function attachmentInRecordFolder(
  layout: WorkspaceFsLayout,
  resolved: { absolutePath: AbsolutePath; displayPath: string },
) {
  const { record } = layout;
  const relative = normalizePath(resolved.displayPath).replace(/^\.\//, "");
  if (
    !record ||
    relative.split("/")[0] !== CHAT_FOLDER_NAMES.attachments ||
    fileExistsSync(resolved.absolutePath)
  ) {
    return undefined;
  }
  const inRecord = applyUnicodeFallbacks(
    absolutePathJoin(record.hostRoot, relative),
  );
  if (!fileExistsSync(inRecord)) {
    return undefined;
  }
  return {
    absolutePath: inRecord,
    displayPath: shellPath(inRecord),
    mount: record,
  };
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
 * chat's folder, plus the normalized display path. Rewrites sloppy input
 * ("work/x") into relative form and rejects traversal out of the chat's folder, including Windows-style "./subdir\\..\\.." on all platforms.
 *
 * This is the relative-only resolver: absolute paths never reach it from
 * resolveAgentPath/resolveWritableToolPath, which pre-handle them against the
 * layout.
 */
export function resolveToolPath(layout: WorkspaceFsLayout, inputPath: string) {
  const fixedPathResult = ensureRelativePath(inputPath);
  if (fixedPathResult.isErr()) {
    return fixedPathResult;
  }
  const displayPath = fixedPathResult.value;

  const absolutePath = resolvePathWithinChatDir({
    dir: layout.chat.hostRoot,
    filePath: displayPath,
  });
  if (!absolutePath) {
    return executeError(`Path escapes the chat's folder: ${inputPath}`);
  }

  return ok({ absolutePath, displayPath });
}

/**
 * Resolve a write-path input against the workspace layout. Relative paths
 * and absolute paths in a writable mount (the workspace skills, a folder the
 * user granted write access) resolve normally; read-only mounts are rejected
 * with copy-into-the-chat's-folder guidance instead of silently landing somewhere else.
 * Whether a mount other than the chat's is writable is decided by its readOnly flag, never
 * by a per-mount special case here.
 *
 * `mount` in the result is the mount that owns the path, or null for a path
 * inside the chat's folder.
 */
export function resolveWritableToolPath(options: {
  inputPath: string;
  layout: WorkspaceFsLayout;
}) {
  const { inputPath, layout } = options;
  const trimmedPath = shellPath(inputPath.trim());

  if (!path.isAbsolute(trimmedPath)) {
    return resolveToolPath(layout, trimmedPath).map((resolved) => ({
      ...resolved,
      mount: null,
    }));
  }

  const result = heldToRules(
    layout,
    resolveAbsolutePath(layout, trimmedPath),
    "write",
  );
  if (result.isErr()) {
    return result;
  }
  const { absolutePath, displayPath, mount } = result.value;
  if (mount?.readOnly) {
    return executeError(
      `"${displayPath}" is in a read-only folder and cannot be written. ` +
        `Copy what you need into this conversation's folder (e.g. cp '${displayPath}' work/) and change the copy.`,
    );
  }
  // The owning mount rides along so a caller whose output contract is
  // relative to the chat's folder can refuse a path in another folder rather than silently
  // resolving it against the chat's folder.
  return ok({ absolutePath, displayPath, mount });
}

/**
 * A path in one of the chat's folders, refused where the rules keep the agent
 * from reading or changing it.
 */
function heldToRules(
  layout: WorkspaceFsLayout,
  resolved: ReturnType<typeof resolveAbsolutePath>,
  op: "read" | "write",
): ReturnType<typeof resolveAbsolutePath> {
  if (resolved.isErr()) {
    return resolved;
  }
  const { absolutePath, displayPath } = resolved.value;
  // The app's internals answer as missing, the way the shell shows them.
  if (reachOf(layout.rules, absolutePath, "read").level === "hidden") {
    return executeError(`No such file or directory: ${displayPath}`);
  }
  const refusal = ruleRefusal({
    hostPath: absolutePath,
    op,
    rules: layout.rules,
    spell: (hostPath) =>
      classifyHostPath(layout, hostPath)?.shellPath ?? hostPath,
  });
  return refusal ? executeError(refusal) : resolved;
}

function fileExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an absolute path in the shell's spelling through the layout.
 * Absolute paths outside every mount error with steering toward a relative
 * path or a folder request.
 */
function resolveAbsolutePath(layout: WorkspaceFsLayout, shellAbsPath: string) {
  const resolved = resolveHostPath(layout, shellAbsPath);

  if (resolved === null) {
    return executeError(
      `The absolute path "${shellAbsPath}" is not in a folder you reach. ` +
        `Use a path relative to this conversation's folder, or the full path of a file in one of the user's folders.`,
    );
  }

  const { hostPath, mount } = resolved;
  const found = classifyHostPath(layout, hostPath, mount);

  if (mount === layout.chat) {
    // Normalize a full path in the chat's folder into the same relative
    // form as relative input so display paths stay consistent across tools.
    const relative = relativeWithin(
      layout.chat.shellRoot,
      normalizePath(shellAbsPath),
    );
    return ok({
      absolutePath: hostPath,
      displayPath: RelativePathSchema.parse(`.${relative ?? "/"}`),
      mount: null,
    });
  }

  // The bash sandbox refuses to traverse symlinks out of a mount; the file
  // tools go through node fs directly, so enforce the same containment here or
  // a symlink inside the folder could read host files.
  if (found === null || found.escapes) {
    return executeError(
      `The path "${shellAbsPath}" resolves outside its folder (via a symlink) and cannot be accessed.`,
    );
  }

  return ok({
    absolutePath: hostPath,
    displayPath: normalizePath(shellAbsPath),
    mount,
  });
}
