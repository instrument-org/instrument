import fs from "node:fs/promises";
import path from "node:path";

import { TASK_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import {
  type AbsolutePath,
  type TaskDir,
  TaskDirSchema,
} from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

export function getArtifactPreviewSessionDir(): AbsolutePath {
  return absolutePathJoin(
    getWorkspaceConfig().rootDir,
    TASK_FOLDER_NAMES.private,
    TASK_FOLDER_NAMES.artifactPreviewSession,
  );
}

export function getBrowserSessionDir(): AbsolutePath {
  return absolutePathJoin(
    getWorkspaceConfig().rootDir,
    TASK_FOLDER_NAMES.private,
    TASK_FOLDER_NAMES.browserSession,
  );
}

// Files the agent downloads (e.g. via the browser). A user-visible top-level
// folder so the user can see them and the agent can reach them with a simple
// relative path.
export function getDownloadsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.downloads);
}

// TMPDIR for invocations that drive a browser outside the app. Workspace-level,
// beside the managed browser's session dir, because `--profile` makes the CLI
// clone the user's real Chrome profile -- cookies, login data, the full
// browsing history -- into the temp dir. A task is the one place that clone
// must not land: everything task-scoped picks it up, from the file index and
// the task layout in the system prompt through the per-turn change list, the
// export zip, and the agent's own reads.
export function getExternalBrowserTmpDir(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return absolutePathJoin(
    rootDir,
    TASK_FOLDER_NAMES.private,
    TASK_FOLDER_NAMES.externalBrowserTmp,
  );
}

// Browser screenshots the agent captures. Under work/ so the agent can read
// them back (it is handed their paths) and the user can browse them; the
// private dir is now off-limits to the agent, so agent-facing outputs cannot
// live there.
export function getScreenshotsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskWorkDir(dir), TASK_FOLDER_NAMES.screenshots);
}

// The user's inputs (uploads + copies from attached folders). A user-visible top-level dir.
export function getTaskAttachmentsDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.attachments);
}

export function getTaskPrivateDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.private);
}

// Subprocess temp dir. TMPDIR/TEMP/TMP point real interpreters here so
// tempfile, os.tmpdir(), and mktemp land inside the task instead of the host
// temp dir. A plain name under work/ so the agent uses it readily and the user
// can browse leftover temp data like the rest of work/.
export function getTaskTmpDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskWorkDir(dir), TASK_FOLDER_NAMES.tmp);
}

// The runnable package and all agent working files live under work/.
export function getTaskWorkDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.work);
}

export function isRunnable(dir: TaskDir): Promise<boolean> {
  return fs
    .access(path.join(getTaskWorkDir(dir), "package.json"))
    .then(() => true)
    .catch(() => false);
}

export function sessionStorePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_DB_FILE_NAME);
}

// The on-disk directory for a task. The id doubles as the folder name, so this
// is a pure path derivation off the workspace singleton — no carrier object.
export function taskDir(id: TaskId): TaskDir {
  return TaskDirSchema.parse(path.join(getWorkspaceConfig().tasksDir, id));
}
