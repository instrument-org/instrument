export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
} as const;

/**
 * What the browsers keep in the workspace's machine folder, under `browser/`:
 * one of each for the workspace rather than one per chat, since neither holds
 * anything a chat put there.
 */
export const BROWSER_FOLDER_NAMES = {
  // agent-browser's `$HOME`: its managed config and the provider plugin
  // (getAgentBrowserHomeDir).
  agentHome: "agent-browser-home",
  // The in-app browser's Chromium profile (getBrowserSessionDir).
  session: "browser-session",
} as const;

export const CHAT_FOLDER_NAMES = {
  attachments: "attachments",
  downloads: "downloads",
  screenshots: "screenshots",
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
 * the workspace's apps; its chat's work folder, where every command starts;
 * the output folder, where finished work goes; the folder of the skill it
 * loaded last, where that skill's scripts run from; and the workspace's own
 * writable skills; and every chat's records, read-only. Every program the shell starts sees them too. The system
 * prompt names folders by these, never by path, so it reads the same on
 * every computer. A file the person sent is read where they keep it, so no
 * variable names a folder of copies.
 */
export const FOLDER_VARIABLES = {
  apps: "INSTRUMENT_APPS",
  chats: "INSTRUMENT_CHATS",
  output: "INSTRUMENT_OUTPUT",
  skill: "INSTRUMENT_SKILL_DIR",
  work: "INSTRUMENT_WORK",
  workspaceSkills: "INSTRUMENT_WORKSPACE_SKILLS",
} as const;
export const TASKS_DIR_NAME = "tasks";
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
 * Where every chat's own folder is, at the workspace's top level: the one
 * folder of the six a person opens that the app writes rather than reads,
 * holding a folder per chat named for what the chat is about.
 */
export const CHATS_FOLDER_NAME = "Chats";
/**
 * A chat's transcript in its folder, written from its records at the end of
 * each turn. Capitalized like the one file that says what a folder is in each
 * of the six: a folder in `Chats/` without it is not a chat's.
 */
export const CHAT_FILE_NAME = "CHAT.md";

/**
 * Where the person's drafts are, at the workspace's top level: a folder per
 * draft, named for the day the draft was started, holding what was pasted
 * into it beside the draft itself.
 */
export const DRAFTS_FOLDER_NAME = "Drafts";
/**
 * A draft in its folder: its front matter says which draft it is and, for a
 * reply, which chat it goes into, and the body is the person's own words.
 * Capitalized like the one file that says what a folder is in each of the
 * six. A folder may hold more than one, since two devices can each write a
 * draft on the same day offline, so the name is matched as a prefix
 * (`DRAFT 2.md`, a sync engine's conflict copy) rather than exactly.
 */
export const DRAFT_FILE_NAME = "DRAFT.md";

/**
 * Where the person's topics are, at the workspace's top level: a folder per
 * topic named for it, each with the `TOPIC.md` that says what it is. One of
 * the six folders a person opens. Here rather than beside the file's own
 * reader (`lib/chat/topic-file.ts`, which re-exports it) because the note
 * naming the file to the model is drawn in the app too, and depends on
 * nothing else.
 */
export const TOPICS_FOLDER_NAME = "Topics";
/**
 * A topic in its folder, its front matter over the standing instructions
 * every chat under it is read with. Capitalized like the one file that says
 * what a folder is in each of the six: a folder in `Topics/` without it is
 * not a topic's.
 */
export const TOPIC_FILE_NAME = "TOPIC.md";

/**
 * Where the person's memories are, at the workspace's top level: one
 * Markdown file per memory, which they read and edit in a file manager like
 * any other file. One of the six folders a person opens, and the one with no
 * file saying what it is: a memory is a file rather than a folder.
 */
export const MEMORY_FOLDER_NAME = "Memory";

/**
 * The workspace's own skills, at its top level: a folder per skill, each
 * with the `SKILL.md` that says what it is. One of the six folders a person
 * opens, and the only one the agent writes into as part of its work, since
 * a chat can leave a skill behind for the chats after it.
 */
export const SKILLS_FOLDER_NAME = "Skills";

/**
 * Where the person's apps are, at the workspace's top level: a folder per
 * app named for it, each with the `APP.md` that says what it is and what it
 * is for. One of the six folders a person opens. Here rather than beside the
 * file's own reader (`lib/apps/app-file.ts`, which re-exports it) because
 * the workspace's layout names the folder and depends on nothing else.
 */
export const APPS_FOLDER_NAME = "Apps";

/**
 * The six folders a person opens, at the workspace's top level, in the order
 * they are listed to a reader. Collected so that something which has to treat
 * them as a set -- the notice for one the person deleted, say -- cannot miss
 * one that is added later.
 */
export const KEY_FOLDER_NAMES = [
  CHATS_FOLDER_NAME,
  DRAFTS_FOLDER_NAME,
  TOPICS_FOLDER_NAME,
  MEMORY_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
  APPS_FOLDER_NAME,
] as const;

export type KeyFolderName = (typeof KEY_FOLDER_NAMES)[number];

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

export const TOOL_PLAN_PARAM_NAME = "plan";

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
 * What a tool call reads when the reply it belonged to ended before its
 * input had finished arriving: an error, an abort, or the person's Stop
 * caught it mid-word, so it never ran. The app was there throughout, which
 * is the whole difference from the line above.
 */
export const CUT_OFF_TOOL_CALL_ERROR_TEXT =
  "This action was cut off before it could run.";

/**
 * What a tool call reads when the user's Stop, or the chat's `instrument task stop` on
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
