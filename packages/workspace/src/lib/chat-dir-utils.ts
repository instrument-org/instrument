import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";

import {
  BROWSER_FOLDER_NAMES,
  CHAT_FOLDER_NAMES,
  HANDOFF_NOTES_FILE_NAME,
} from "../constants";
import {
  type AbsolutePath,
  type ChatDir,
  type WorkDir,
} from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { type DeviceId } from "./records/device-id";
import { workspaceMachineDir } from "./workspace-machine-dir";

/** The in-app browser's Chromium profile, on this computer's side of the workspace. */
export function getBrowserSessionDir(): AbsolutePath {
  return absolutePathJoin(
    workspaceMachineDir(),
    WORKSPACE_MACHINE_ENTRIES.browser,
    BROWSER_FOLDER_NAMES.session,
  );
}

/**
 * `agent-browser`'s home: the managed config and provider plugin it runs
 * with, and anything it keeps under `$HOME`. On this computer's side of the
 * workspace and out of the agent's reach, since the plugin is code
 * `agent-browser` runs outside every sandbox.
 *
 * One for the workspace rather than one per chat. Every chat's held the same
 * empty `config.json` and the same plugin script, written again on each
 * invocation, so a chat could learn nothing from another's; what a chat
 * keeps apart is its session, which names the daemon.
 */
export function getAgentBrowserHomeDir(): AbsolutePath {
  return absolutePathJoin(
    workspaceMachineDir(),
    WORKSPACE_MACHINE_ENTRIES.browser,
    BROWSER_FOLDER_NAMES.agentHome,
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

/** What the person sent the chat: `attachments/` in its record folder. */
export function chatAttachmentsDir(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, CHAT_FOLDER_NAMES.attachments);
}

/** Where one device left off in a chat, in its record folder; only that device writes it. */
export function chatStatePath(dir: ChatDir, device: DeviceId): AbsolutePath {
  return absolutePathJoin(dir, `state.${device}.json`);
}

/**
 * The notes the agent keeps for whoever carries the chat on after its
 * context runs out: a record of the conversation, so it travels with it, and
 * the one file in the record folder the agent writes.
 */
export function handoffNotesPath(dir: ChatDir): AbsolutePath {
  return absolutePathJoin(dir, HANDOFF_NOTES_FILE_NAME);
}
