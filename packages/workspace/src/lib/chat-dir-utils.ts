import { CHAT_DB_FILE_NAME, CHAT_FOLDER_NAMES } from "../constants";
import { type AbsolutePath, type ChatDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

export function getBrowserSessionDir(): AbsolutePath {
  return absolutePathJoin(
    getWorkspaceConfig().rootDir,
    CHAT_FOLDER_NAMES.private,
    CHAT_FOLDER_NAMES.browserSession,
  );
}

// Files the agent downloads (e.g. via the browser). A user-visible top-level
// folder so the user can see them and the agent can reach them with a simple
// relative path.
export function getDownloadsDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.downloads);
}

// TMPDIR for invocations that drive a browser outside the app. Workspace-level,
// beside the managed browser's session dir, because `--profile` makes the CLI
// clone the user's real Chrome profile -- cookies, login data, the full
// browsing history -- into the temp dir. A task is the one place that clone
// must not land: everything task-scoped picks it up, from the file index and
// the task layout in the system prompt through the per-turn change list and
// the agent's own reads.
export function getExternalBrowserTmpDir(
  rootDir: AbsolutePath = getWorkspaceConfig().rootDir,
): AbsolutePath {
  return absolutePathJoin(
    rootDir,
    CHAT_FOLDER_NAMES.private,
    CHAT_FOLDER_NAMES.externalBrowserTmp,
  );
}

// Browser screenshots the agent captures. Under work/ so the agent can read
// them back (it is handed their paths) and the user can browse them; the
// private dir is now off-limits to the agent, so agent-facing outputs cannot
// live there.
export function getScreenshotsDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(getChatWorkDir(dir), CHAT_FOLDER_NAMES.screenshots);
}

// The user's inputs (uploads + copies from folder mounts). A user-visible top-level dir.
export function getChatAttachmentsDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.attachments);
}

export function getChatPrivateDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.private);
}

// Subprocess temp dir. TMPDIR/TEMP/TMP point real interpreters here so
// tempfile, os.tmpdir(), and mktemp land inside the task instead of the host
// temp dir.
export function getChatTmpDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.tmp);
}

// Scratch: source, scripts, and intermediate files the agent writes. Holds no
// package of its own, so what lands here resolves the task's dependencies by
// walking up to the root like anything else in the task.
export function getChatWorkDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.work);
}

export function sessionStorePath(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(getChatPrivateDir(dir), CHAT_DB_FILE_NAME);
}
