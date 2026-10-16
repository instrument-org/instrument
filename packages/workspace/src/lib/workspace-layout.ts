import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import path from "node:path";

import { CHAT_FOLDER_NAMES } from "../constants";

// Depends on nothing of the workspace's but its names, so the app's main
// process, which reads and writes some of these folders before the workspace
// is up, lays out the same ones the workspace reads. Its own package entry
// (`@instrument-org/workspace/layout`) keeps the import that cheap.

/**
 * What each folder the app keeps in a workspace's `.instrument/` is called.
 * The names are the ones these folders had at the workspace's top level
 * before they moved in, which the layout sweep relies on.
 */
export const WORKSPACE_DATA_ENTRIES = {
  /** One folder per connected app: its setup, never its secrets. */
  apps: "apps",
  /**
   * One record folder per chat, its tasks included: `chat.db`,
   * `settings.json`, `attachments/`, `handoff-notes.md`.
   */
  chats: "chats",
  /**
   * Where earlier builds kept the drafts, a folder each: the words in
   * `draft.md`, what was pasted into them beside those, and the rest of each
   * record in its own `.instrument/settings.json`. A draft is in `Drafts/` at
   * the workspace's top level now, and this is only what the migration reads
   * (`lib/drafts/migrate.ts`).
   */
  drafts: "drafts",
  /**
   * Where earlier builds kept the memories, one Markdown file each: what the
   * agent keeps about the person across every chat. Memory is `Memory/` at
   * the workspace's top level now, and this is only what the migration reads
   * (`lib/memory/move.ts`).
   */
  memory: "memory",
  /**
   * What the migrations set aside rather than delete: 1.x projects and empty
   * tasks, the records of tasks an earlier build kept in a chat, and the
   * empty database a chat held while its sessions were in another file.
   */
  setAside: ".pre-chats",
  /** The workspace's own skills, which the agent reads and writes. */
  skills: "skills",
  /**
   * One folder per topic, named for it: its settings in
   * `.instrument/settings.json` and its instructions in `instructions.md`.
   */
  topics: "topics",
  /**
   * Where earlier builds kept a record folder for the window, which is
   * scoped as a chat is; removed at launch (`settleWorkspaceDb`).
   */
  window: "window",
} as const;

/**
 * What in a workspace's `.instrument/` is the person's own to look at, each
 * as the names below it, `*` standing for any one: what they attached to a
 * chat, and their topics, skills and apps. Everything else there (a chat's
 * database and settings, the workspace's own records, the window's) is the
 * app's, and so is a record folder of its own inside one of these, which
 * carries the same `.instrument` name.
 */
export const PERSON_FOLDERS_IN_DATA_DIR: readonly (readonly string[])[] = [
  [WORKSPACE_DATA_ENTRIES.apps],
  [WORKSPACE_DATA_ENTRIES.chats, "*", CHAT_FOLDER_NAMES.attachments],
  [WORKSPACE_DATA_ENTRIES.skills],
  [WORKSPACE_DATA_ENTRIES.topics],
];

/**
 * The app's folders in a workspace, every one inside its hidden
 * `.instrument/` (`dataDir`), so the workspace's top level holds only the
 * person's own work and the app's part of it travels as one folder.
 */
export function workspaceLayout(workspaceDir: string) {
  const dataDir = path.join(workspaceDir, PRIVATE_FOLDER_NAME);
  const entry = (name: string) => path.join(dataDir, name);
  return {
    appsDir: entry(WORKSPACE_DATA_ENTRIES.apps),
    chatsDir: entry(WORKSPACE_DATA_ENTRIES.chats),
    /**
     * What the app keeps that travels with the workspace: `workspace.json`,
     * `preferences.json`, `features.json`, `bookmarks.json`, and every folder
     * below.
     */
    dataDir,
    draftsDir: entry(WORKSPACE_DATA_ENTRIES.drafts),
    memoryDir: entry(WORKSPACE_DATA_ENTRIES.memory),
    setAsideDir: entry(WORKSPACE_DATA_ENTRIES.setAside),
    skillsDir: entry(WORKSPACE_DATA_ENTRIES.skills),
    topicsDir: entry(WORKSPACE_DATA_ENTRIES.topics),
    windowDir: entry(WORKSPACE_DATA_ENTRIES.window),
  };
}
