export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
  templates: "templates",
} as const;

import { TASK_PRIVATE_FOLDER_NAME } from "@instrument-org/shared";

export const TASK_FOLDER_NAMES = {
  agentBrowserState: "agent-browser",
  agentRetrieved: "agent-retrieved",
  browserSession: "browser-session",
  output: "output",
  private: TASK_PRIVATE_FOLDER_NAME,
  scripts: "scripts",
  skills: "skills",
  src: "src",
  state: ".state",
  tmp: "tmp",
  userProvided: "user-provided",
} as const;
export const SESSIONS_DB_FILE_NAME = "sessions.db";

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
