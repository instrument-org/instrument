export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
} as const;

import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

export const CHAT_FOLDER_NAMES = {
  attachments: "attachments",
  browserSession: "browser-session",
  downloads: "downloads",
  // agent-browser's temp dir for external-browser invocations. Lives at the
  // workspace root rather than in a task (see getExternalBrowserTmpDir): what
  // lands there is a copy of the host's browser state, not task content.
  externalBrowserTmp: "external-browser-tmp",
  private: PRIVATE_FOLDER_NAME,
  screenshots: "screenshots",
  skills: "skills",
  // Subprocess temp dir (TMPDIR/TEMP/TMP), inside the task so tempfile spill
  // and mktemp scratch land here instead of the host temp dir. Dot-prefixed
  // because what accumulates is interpreter caches rather than anything the
  // user would recognize, and the file index excludes it on that basis.
  tmp: ".tmp",
  // Dot-prefixed (see bash.ts): the agent is handed spill-file paths and must
  // read them, but the logs are noise for the user so they stay out of the
  // browsable file index.
  toolOutput: ".tool-output",
  work: "work",
} as const;
export const TASKS_DIR_NAME = "tasks";
// One folder per chat at the workspace root, its tasks included: a task is a
// session in the chat's database, with no folder of its own.
export const CHATS_DIR_NAME = "chats";
// One folder per app at the workspace root, mounted at /apps for the
// chat. Secrets never live here; the app's stores hold them.
export const APPS_DIR_NAME = "apps";
// One Markdown file per memory at the workspace root: what the conversation's
// agent keeps about the user across every chat, readable and editable in a
// file manager.
export const MEMORY_DIR_NAME = "memory";
// One folder per topic at the workspace root, named for the topic: its
// settings in `.instrument/settings.json` and its instructions in
// `instructions.md`.
export const TOPICS_DIR_NAME = "topics";
// A chat's SQLite store, every session in it, in its `.instrument/` private dir.
export const CHAT_DB_FILE_NAME = "chat.db";
// What the store was named in a 1.x task and in a chat before the layout
// sweep renamed it: read by the migrations alone.
export const LEGACY_TASK_DB_FILE_NAME = "task.db";
export const TASK_STATE_FILE_NAME = "state.json";

/**
 * Info string of the fenced block an agent writes to show the user a set of
 * files: one workspace path per line. Shared because it is a contract between
 * the prompt that teaches it and the renderer that draws it, and a fence
 * language the renderer does not know renders as a code block.
 */
export const AGENT_FILES_LANGUAGE = "files";

/**
 * Info string of the fenced block an agent writes to hand the user words they
 * will send as their own: an email, a text, a post. The same front matter and
 * body make a Markdown file a message, so a fence and a file draw one card.
 */
export const AGENT_MESSAGE_LANGUAGE = "message";

/**
 * Info string of the fenced block a task started by the chat ends its turn
 * with when it cannot go on without something from the user or the chat: one
 * need per line, `<kind>: <what, and what for>`. A contract between the task's
 * prompt and the wake note that reads it.
 */
export const AGENT_NEEDS_LANGUAGE = "needs";

/**
 * Character budget for the project instructions inlined into a task's standing
 * context.
 *
 * The instructions are an `AGENTS.md` the user can paste anything into, and they
 * ride in the session-context message on every turn, so an unbounded one eats
 * the context window before the task starts. Characters rather than tokens for
 * the same reason as the skill catalog's budget: no tokenizer is right for every
 * provider we run against. This is roughly 4,200 tokens of Markdown prose, and
 * closer to 13,000 if the file is written in CJK.
 */
export const MAX_PROJECT_INSTRUCTIONS_LENGTH = 20_000;

export const TOOL_ACTIVITY_PARAM_NAME = "activity";

export const TOOL_EXPLANATION_PARAM_NAME = "explanation";
