import {
  HOME_DATA_ENTRIES,
  HOME_FOLDERS,
  PRIVATE_FOLDER_NAME,
} from "@instrument-org/shared";
import path from "node:path";

import { APPS_FOLDER_NAME, CHAT_FOLDER_NAMES } from "../constants";

// Depends on nothing of the workspace's but its names, so the app's main
// process, which reads and writes some of these folders before the workspace
// is up, lays out the same ones the workspace reads. Its own package entry
// (`@instrument-org/workspace/layout`) keeps the import that cheap.

/**
 * What each folder the app keeps in a workspace's `.instrument/` is called.
 * The names are the ones these folders had at the workspace's top level
 * before they moved in, which the layout sweep relies on.
 *
 * The first group is what the app reads and writes. The second is what only
 * the migrations read: where earlier builds kept what is at the workspace's
 * top level today (`Apps/`, `Drafts/`, `Memory/`, `Skills/`, `Topics/`), and
 * the window's record folder that launch removes.
 */
export const WORKSPACE_DATA_ENTRIES = {
  /**
   * One record folder per chat, its tasks included: each device's log per
   * session (`<session>.<device>.jsonl`), settings file
   * (`settings.<device>.jsonl`) and state file (`state.<device>.json`),
   * `blobs/`, `attachments/` and `handoff-notes.md`.
   */
  chats: "chats",
  /**
   * One folder per device that has opened the workspace, named by its device
   * id: what only that device writes and every device reads, which
   * computer it is (`device.json`, `records/device-file.ts`), its activity
   * log a file per month (`activity/<YYYY-MM>.jsonl`) and its file of each
   * synced store (`<domain>.jsonl`, `lib/synced-store/`), `bookmarks.jsonl`
   * among them.
   */
  devices: "devices",
  /**
   * What the migrations set aside rather than delete: 1.x projects and empty
   * tasks, the records of tasks an earlier build kept in a chat, and the
   * empty database a chat held while its sessions were in another file.
   */
  setAside: ".pre-chats",

  // Migration only, from here down.

  /**
   * Where earlier builds kept the apps, a folder each named for the app's
   * slug: its setup in `app.json` and what it is for in `guide.md`. An app is
   * an `APP.md` in `Apps/` at the workspace's top level, and this is only
   * what the migration reads (`lib/apps-move.ts`).
   */
  apps: "apps",
  /**
   * Where earlier builds kept the drafts, a folder each: the words in
   * `draft.md`, what was pasted into them beside those, and the rest of each
   * record in its own `.instrument/settings.json`. A draft is in `Drafts/` at
   * the workspace's top level, and this is only what the migration reads
   * (`lib/drafts/migrate.ts`).
   */
  drafts: "drafts",
  /**
   * Where earlier builds kept the memories, one Markdown file each. Memory is
   * `Memory/` at the workspace's top level, and this is only what the
   * migration reads (`lib/memory/move.ts`).
   */
  memory: "memory",
  /**
   * Where earlier builds kept the workspace's own skills. Skills are in
   * `Skills/` at the workspace's top level, and this is only what the
   * migration reads (`lib/skills-move.ts`).
   */
  skills: "skills",
  /**
   * Where earlier builds kept the topics, a folder each named for the topic:
   * its settings in `.instrument/settings.json` and its instructions in
   * `instructions.md`. A topic is a `TOPIC.md` in `Topics/` at the
   * workspace's top level, and this is only what the migration reads
   * (`lib/topics-move.ts`).
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
 * chat. Everything else there (a chat's records, the workspace's own
 * records, the window's) is the app's, and so is a record folder of its own
 * inside one of these, which carries the same `.instrument` name.
 */
export const PERSON_FOLDERS_IN_DATA_DIR: readonly (readonly string[])[] = [
  [WORKSPACE_DATA_ENTRIES.chats, "*", CHAT_FOLDER_NAMES.attachments],
];

/**
 * The app's folders in a workspace, every one inside its hidden
 * `.instrument/` (`dataDir`) but the person's apps, so the workspace's top
 * level holds only the person's own work and the app's part of it travels
 * as one folder.
 */
export function workspaceLayout(workspaceDir: string) {
  const dataDir = path.join(workspaceDir, PRIVATE_FOLDER_NAME);
  const entry = (name: string) => path.join(dataDir, name);
  return {
    /**
     * The person's apps, at the workspace's top level rather than in here:
     * a folder per app, each with the `APP.md` that says what it is.
     */
    appsDir: path.join(workspaceDir, APPS_FOLDER_NAME),
    chatsDir: entry(WORKSPACE_DATA_ENTRIES.chats),
    /**
     * What the app keeps that travels with the workspace: `workspace.json`
     * and every folder below.
     */
    dataDir,
    devicesDir: entry(WORKSPACE_DATA_ENTRIES.devices),
    setAsideDir: entry(WORKSPACE_DATA_ENTRIES.setAside),

    // Migration only, from here down: where earlier builds kept what is at
    // the workspace's top level today, and the window's record folder that
    // launch removes. Nothing but a migration, a launch sweep or its tests
    // reads these.
    draftsDir: entry(WORKSPACE_DATA_ENTRIES.drafts),
    memoryDir: entry(WORKSPACE_DATA_ENTRIES.memory),
    skillsDir: entry(WORKSPACE_DATA_ENTRIES.skills),
    topicsDir: entry(WORKSPACE_DATA_ENTRIES.topics),
    windowDir: entry(WORKSPACE_DATA_ENTRIES.window),
  };
}

/**
 * What the app keeps in the person's home folder, in its flavor's data
 * folder (`HOME_FOLDERS.data`, `~/.instrument/` for the app people install):
 * every workspace's chats' work folders, `work/<workspace>/<chat>/`
 * (`HOME_DATA_ENTRIES`), what the agent made for the person where they can
 * find it. Closed to the agent but for the chat's own work folder.
 */
export function homeDataLayout(home: string, folder = HOME_FOLDERS.data) {
  const dataDir = path.join(home, folder);
  return {
    dataDir,
    workDir: path.join(dataDir, HOME_DATA_ENTRIES.work),
  };
}
