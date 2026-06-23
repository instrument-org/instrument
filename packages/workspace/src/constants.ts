export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
  templates: "templates",
} as const;

import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

export const TASK_FOLDER_NAMES = {
  attachments: "attachments",
  browserSession: "browser-session",
  downloads: "downloads",
  output: "output",
  private: TASK_PRIVATE_FOLDER_NAME,
  screenshots: "screenshots",
  skills: "skills",
  toolOutput: "tool-output",
  work: "work",
} as const;
export const TASKS_DIR_NAME = "tasks";
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
