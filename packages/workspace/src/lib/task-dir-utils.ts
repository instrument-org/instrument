import { TASK_DB_FILE_NAME, TASK_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { absolutePathJoin } from "./absolute-path-join";
import { recordDir } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";

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
// temp dir.
export function getTaskTmpDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.tmp);
}

// Scratch: source, scripts, and intermediate files the agent writes. Holds no
// package of its own, so what lands here resolves the task's dependencies by
// walking up to the root like anything else in the task.
export function getTaskWorkDir(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(dir, TASK_FOLDER_NAMES.work);
}

export function sessionStorePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), TASK_DB_FILE_NAME);
}

// The on-disk directory for a task or a chat. The id doubles as the folder
// name; where that folder sits (flat under `tasks/`, a chat's own under
// `chats/`, or inside the chat that started it) is `recordDir`'s to say.
export function taskDir(id: TaskId): TaskDir {
  return recordDir(id);
}
