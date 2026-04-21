export const REGISTRY_FOLDER_NAMES = {
  skills: "skills",
  templates: "templates",
} as const;

import {
  APP_PRIVATE_FOLDER_NAME,
  GIT_AGENT_EMAIL,
  GIT_AGENT_NAME,
  GIT_TRAILER_INITIAL_COMMIT,
  GIT_TRAILER_TEMPLATE,
} from "@instrument-org/shared";

export const APP_FOLDER_NAMES = {
  agentRetrieved: "agent-retrieved",
  browserSession: "browser-session",
  output: "output",
  private: APP_PRIVATE_FOLDER_NAME,
  scripts: "scripts",
  skills: "skills",
  src: "src",
  tmp: "tmp",
  toolResults: "tool-results",
  userProvided: "user-provided",
} as const;
export const SESSIONS_DB_FILE_NAME = "sessions.db";

export const APP_STATUSES = [
  "error",
  "loading",
  "not-found",
  "ready",
  "stopped",
  "not-runnable",
  "unknown",
] as const;

export const GIT_AUTHOR = {
  email: GIT_AGENT_EMAIL,
  name: GIT_AGENT_NAME,
};
export const GIT_TRAILERS = {
  initialCommit: GIT_TRAILER_INITIAL_COMMIT,
  template: GIT_TRAILER_TEMPLATE,
};

// Limit prompt storage to 50KB to avoid blowing up the JSON file
export const MAX_PROMPT_STORAGE_LENGTH = 50_000;
