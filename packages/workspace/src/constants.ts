export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
  templates: "templates",
} as const;

import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

export const TASK_FOLDER_NAMES = {
  attachments: "attachments",
  browserSession: "browser-session",
  downloads: "downloads",
  // agent-browser's temp dir for external-browser invocations. Lives at the
  // workspace root rather than in a task (see getExternalBrowserTmpDir): what
  // lands there is a copy of the host's browser state, not task content.
  externalBrowserTmp: "external-browser-tmp",
  private: TASK_PRIVATE_FOLDER_NAME,
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
// One folder per chat at the workspace root, and the tasks a chat started in a
// `tasks/` folder inside its own, so a chat and its work are one folder.
export const CHATS_DIR_NAME = "chats";
// One folder per app at the workspace root, mounted at /apps for the
// orchestrator. Secrets never live here; the app's stores hold them.
export const APPS_DIR_NAME = "apps";
// One Markdown file per memory at the workspace root: what the conversation's
// agent keeps about the user across every thread, readable and editable in a
// file manager.
export const MEMORY_DIR_NAME = "memory";
// One folder per topic at the workspace root, holding its `topic.md`: the mark
// the window draws in front matter, and the topic's instructions as the body.
export const TOPICS_DIR_NAME = "topics";
// Projects are real folders at the workspace root, named by the (sanitized)
// project name. Their identity + instructions live inside each folder.
export const PROJECTS_DIR_NAME = "projects";
// A project's instructions live in a visible, hand-editable AGENTS.md at the
// project folder root; identity lives in `.instrument/settings.json`.
export const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
// Per-task SQLite store in the task's `.instrument/` private dir.
export const TASK_DB_FILE_NAME = "task.db";
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
 * Character budget for the project instructions inlined into a task's standing
 * context.
 *
 * The instructions are an `AGENTS.md` the user can paste anything into, and they
 * ride in the session-context message on every turn, so an unbounded one eats
 * the context window before the task starts. Characters rather than tokens for
 * the same reason as the skill catalog's budget: no tokenizer is right for every
 * provider we run against. This is roughly 4,200 tokens of Markdown prose, and
 * closer to 13,000 if the file is written in CJK.
 *
 * Nothing is lost to the cap. The project folder mounts at MOUNT.project,
 * so what does not fit stays one read away and the truncated block says where.
 */
export const MAX_PROJECT_INSTRUCTIONS_LENGTH = 20_000;

// Limit prompt storage to 50KB to avoid blowing up the JSON file
export const MAX_PROMPT_STORAGE_LENGTH = 50_000;
export const TOOL_EXPLANATION_PARAM_NAME = "explanation";
