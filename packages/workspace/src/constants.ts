export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
} as const;

export const CHAT_FOLDER_NAMES = {
  // agent-browser's home for one chat, under the workspace's machine folder
  // (getAgentBrowserHomeDir).
  agentBrowserHome: "agent-browser-home",
  attachments: "attachments",
  browserSession: "browser-session",
  downloads: "downloads",
  screenshots: "screenshots",
  skills: "skills",
  // Subprocess temp dir (TMPDIR/TEMP/TMP), inside the chat's folder so tempfile spill
  // and mktemp scratch land here instead of the host temp dir. Dot-prefixed
  // because what accumulates is interpreter caches rather than anything the
  // user would recognize, and the file index excludes it on that basis.
  tmp: ".tmp",
  // Dot-prefixed (see bash.ts): the agent is handed spill-file paths and must
  // read them, but the logs are noise for the user so they stay out of the
  // browsable file index.
  toolOutput: ".tool-output",
} as const;

/**
 * The variables the agent's shell sets, naming the folders it works with:
 * its chat's work folder, where every command starts; what the person sent
 * the chat, in its record folder; and the output folder, where finished work
 * goes. Every program the shell starts sees them too.
 */
export const FOLDER_VARIABLES = {
  attachments: "INSTRUMENT_ATTACHMENTS",
  output: "INSTRUMENT_OUTPUT",
  work: "INSTRUMENT_WORK",
} as const;
export const TASKS_DIR_NAME = "tasks";
// One folder per chat at the workspace root, its tasks included: a task is a
// session in the chat's database, with no folder of its own.
export const CHATS_DIR_NAME = "chats";
// One folder per app at the workspace root, mounted for the
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
// A chat's SQLite store, every session in it, in its record folder.
export const CHAT_DB_FILE_NAME = "chat.db";
// The notes the agent keeps for whoever carries a chat on after its context
// runs out, in the chat's record folder (handoffNotesPath).
export const HANDOFF_NOTES_FILE_NAME = "handoff-notes.md";
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

export const TOOL_ACTIVITY_PARAM_NAME = "activity";

export const TOOL_EXPLANATION_PARAM_NAME = "explanation";

/**
 * What a tool call reads when the app closed while it ran: written by the quit
 * on a task's call it cut off, and by the next launch's sweep on any call a
 * process left in flight. Matched by what reads a call as cut off rather than
 * failed.
 */
export const INTERRUPTED_TOOL_CALL_ERROR_TEXT =
  "This action was interrupted when the app closed.";

/**
 * What a tool call reads when the user's Stop, or the chat's `task stop` on
 * a task, ended it. Matched by what reads the chat's turn as stopped by the
 * user rather than finished. The person reads it; the model reads words of
 * its own in its place (`SessionMessage.toUIMessages`).
 */
export const STOPPED_TOOL_CALL_ERROR_TEXT = "This action was stopped by you.";

/**
 * What a chat is called until it is named: its session's title, and its
 * settings' name, until the first exchange retitles it.
 */
export const UNTITLED_CHAT_TITLE = "Untitled chat";
