export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
  templates: "templates",
} as const;

import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

export const TASK_FOLDER_NAMES = {
  // Storage profile for the HTML artifact-preview guests, kept apart from
  // `browserSession` so agent-authored pages get their own cookie jar and
  // storage rather than sharing the browsing profile. One directory for all
  // tasks: per-task isolation already comes from the distinct asset origins.
  artifactPreviewSession: "artifact-preview-session",
  attachments: "attachments",
  browserSession: "browser-session",
  downloads: "downloads",
  // agent-browser's temp dir for external-browser invocations. Lives at the
  // workspace root rather than in a task (see getExternalBrowserTmpDir): what
  // lands there is a copy of the host's browser state, not task content.
  externalBrowserTmp: "external-browser-tmp",
  output: "output",
  private: TASK_PRIVATE_FOLDER_NAME,
  screenshots: "screenshots",
  skills: "skills",
  // Subprocess temp dir (TMPDIR/TEMP/TMP), under work/ so tempfile spill and
  // mktemp scratch land inside the task instead of the host temp dir. A plain
  // (non-dotted) name: work/ is the agent's raw workspace, so leftover temp
  // data stays visible and browsable like the rest of it.
  tmp: "tmp",
  // Dot-prefixed and written under work/ (see bash.ts): the agent is handed
  // spill-file paths and must read them, but the logs are noise for the user so
  // they stay out of the browsable file index.
  toolOutput: ".tool-output",
  work: "work",
} as const;
export const TASKS_DIR_NAME = "tasks";
// Projects are real folders at the workspace root, named by the (sanitized)
// project name. Their identity + instructions live inside each folder.
export const PROJECTS_DIR_NAME = "projects";
// A project's instructions live in a visible, hand-editable AGENTS.md at the
// project folder root; identity lives in `.instrument/settings.json`.
export const PROJECT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
// Per-task SQLite store in the task's `.instrument/` private dir.
export const TASK_DB_FILE_NAME = "task.db";
export const TASK_STATE_FILE_NAME = "state.json";

export const TASK_STATUSES = [
  "error",
  "loading",
  "not-found",
  "ready",
  "stopped",
  "not-runnable",
  "unknown",
] as const;

// Limit prompt storage to 50KB to avoid blowing up the JSON file
export const MAX_PROMPT_STORAGE_LENGTH = 50_000;
export const TOOL_EXPLANATION_PARAM_NAME = "explanation";
