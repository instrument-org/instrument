import {
  SETTINGS_FILE_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";

import {
  CHAT_DB_FILE_NAME,
  CHAT_FOLDER_NAMES,
  HANDOFF_NOTES_FILE_NAME,
} from "../constants";
import { type ChatId } from "../schemas/chat-id";
import {
  type AbsolutePath,
  type ChatDir,
  type WorkDir,
} from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { workspaceMachineDir } from "./workspace-machine-dir";

/** The in-app browser's Chromium profile, on this computer's side of the workspace. */
export function getBrowserSessionDir(): AbsolutePath {
  return absolutePathJoin(
    workspaceMachineDir(),
    WORKSPACE_MACHINE_ENTRIES.browser,
    CHAT_FOLDER_NAMES.browserSession,
  );
}

/**
 * `agent-browser`'s home for one chat: the managed config and provider
 * plugin it runs with, and anything it keeps under `$HOME`. On this
 * computer's side of the workspace and out of the agent's reach, since the
 * plugin is code `agent-browser` runs outside every sandbox.
 */
export function getAgentBrowserHomeDir(id: ChatId): AbsolutePath {
  return absolutePathJoin(
    workspaceMachineDir(),
    WORKSPACE_MACHINE_ENTRIES.browser,
    CHAT_FOLDER_NAMES.agentBrowserHome,
    id,
  );
}

// Files the agent downloads (e.g. via the browser). A user-visible top-level
// folder so the user can see them and the agent can reach them with a simple
// relative path.
export function getDownloadsDir(dir: WorkDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.downloads);
}

// Browser screenshots the agent captures, in its work folder so it can read
// them back (it is handed their paths) and the user can browse them.
export function getScreenshotsDir(dir: WorkDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.screenshots);
}

/**
 * What the person sent the chat, in its record folder: files are read there
 * in place, and the agent may read them but never change them.
 */
export function getChatAttachmentsDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.attachments);
}

/** A chat's settings and where the person left off, in its record folder. */
export function chatSettingsPath(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, SETTINGS_FILE_NAME);
}

/**
 * The notes the agent keeps for whoever carries the chat on after its
 * context runs out: a record of the conversation, so it travels with it, and
 * the one file in the record folder the agent writes.
 */
export function handoffNotesPath(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, HANDOFF_NOTES_FILE_NAME);
}

export function sessionStorePath(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_DB_FILE_NAME);
}
