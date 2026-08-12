import fs from "node:fs";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../constants";

// Where the package lived when `work/` was the task's runnable root. Spelled
// out rather than built from the current folder names, because these are the
// names the builds that wrote them used, and those names have since moved.
const LEGACY_WORK_DIR_NAME = "work";
const LEGACY_TMP_DIR_NAME = "tmp";

// Entries that made `work/` a package, moved back up to the task root. The
// virtualenv comes along: a uv venv resolves `sys.prefix` from the interpreter's
// own location, so it keeps working from the new path, and leaving it behind
// would silently cost the task every package the agent had installed into it.
const ROOT_ENTRY_NAMES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "node_modules",
  ".venv",
];

/**
 * Moves a task's runnable package from `work/` up to the task root.
 *
 * The task root is now the package, so a dependency resolves from any depth in
 * the task and from inline `node -e` code. A task left in the old shape has its
 * manifest somewhere nothing looks: it reads as not-runnable, `pnpm add` finds
 * no manifest to add to, and Python starts over in a second virtualenv.
 *
 * Synchronous and idempotent. A task already folded has nothing at the old
 * paths and returns without writing. An entry that already exists at the root
 * wins and the one under `work/` is left alone, so a half-finished fold never
 * overwrites the newer copy on its next attempt.
 */
export function foldTaskWorkDir(taskFolder: string): void {
  const workDir = path.join(taskFolder, LEGACY_WORK_DIR_NAME);
  if (!fs.existsSync(workDir)) {
    return;
  }

  for (const name of ROOT_ENTRY_NAMES) {
    moveIfMissingTarget(path.join(workDir, name), path.join(taskFolder, name));
  }

  // The temp dir moved and gained a dot with it. Without this its contents stay
  // under a name the file index no longer excludes, so a V8 compile cache from
  // some earlier turn surfaces to the user as files they changed.
  moveIfMissingTarget(
    path.join(workDir, LEGACY_TMP_DIR_NAME),
    path.join(taskFolder, TASK_FOLDER_NAMES.tmp),
  );

  // `.tool-output` deliberately stays where it is, like `.state`: the task db
  // holds direct paths to the spill files the agent was handed, so moving them
  // would turn every one of those references into a dead link. The name is
  // excluded from the file index at every depth, so it costs nothing to leave.

  foldWorkspacePackageGlobs(path.join(taskFolder, "pnpm-workspace.yaml"));
}

/**
 * Repoints a moved `pnpm-workspace.yaml` at the skills that are still in
 * `work/`, and drops pnpm's add-to-the-root guard.
 *
 * The file is rewritten line by line rather than parsed and re-emitted: it is
 * app-owned config the agent is allowed to edit (to widen `allowBuilds` when an
 * install asks it to), and a round trip through a YAML serializer would discard
 * the comments explaining every setting in it.
 */
function foldWorkspacePackageGlobs(workspaceFile: string): void {
  let contents: string;
  try {
    contents = fs.readFileSync(workspaceFile, "utf8");
  } catch {
    return;
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  let changed = false;

  for (const [index, line] of lines.entries()) {
    const [, bullet, glob] =
      /^(\s*-\s*)(skills\/\*(?:\/\*)?)\s*$/.exec(line) ?? [];
    if (bullet !== undefined && glob !== undefined) {
      lines[index] = `${bullet}${LEGACY_WORK_DIR_NAME}/${glob}`;
      changed = true;
    }
  }

  if (!lines.some((line) => line.startsWith("ignoreWorkspaceRootCheck:"))) {
    // Appended rather than inserted in key order: the keys around it carry
    // comments that belong to them, and nothing here reads this file back.
    // Trailing blanks come off first so the key lands against the last setting
    // rather than after the empty string a trailing newline splits into.
    while (lines.at(-1) === "") {
      lines.pop();
    }
    lines.push("ignoreWorkspaceRootCheck: true", "");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(workspaceFile, lines.join(newline));
  }
}

function moveIfMissingTarget(source: string, destination: string): void {
  if (fs.existsSync(source) && !fs.existsSync(destination)) {
    fs.renameSync(source, destination);
  }
}
