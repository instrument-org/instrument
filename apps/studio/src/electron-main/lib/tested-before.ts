import {
  CHAT_DB_FILE_NAME,
  LEGACY_TASK_DB_FILE_NAME,
  TASKS_DIR_NAME,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Whether a build is one only testers ran: a `-beta.` prerelease of 2.x, or
 * anything before 2.0.0 (1.x, and a 2.0.0 prerelease of any kind). Read from
 * the version string alone, so the same chat answers the same on every
 * computer and at any date.
 */
export function isTestBuild(version: string): boolean {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prerelease = match[4];
  if (major !== 2) {
    return major < 2;
  }
  return (
    prerelease !== undefined &&
    (prerelease.startsWith("beta.") || (minor === 0 && patch === 0))
  );
}

/**
 * Where the 1.x layout migration set aside each task it made into a chat
 * (`.pre-chats/task-records/<chat>`), inside the workspace, so it travels
 * with it.
 */
const TASK_RECORDS_SET_ASIDE = "task-records";

/**
 * Where a chat's converted `chat.db` goes, in the workspace's machine folder
 * (`convert-chat-records.ts`).
 */
const SET_ASIDE_CHAT_DB = path.join("set-aside", "chat-db");

/** A session log's name: `<session>.<device>[.<n>][<copy>].jsonl`. */
const LOG_NAME = /^ses_[0-9A-HJKMNP-TV-Z]{26}\..+\.jsonl$/;

/** The longest first line read for a log's header. */
const HEADER_BYTES = 16 * 1024;

const HeaderSchema = z.object({
  app: z.string(),
  parent: z.string().optional(),
  t: z.literal("session"),
});

/**
 * Whether someone who tested Instrument used this workspace: a chat in it
 * was started by a test build (`isTestBuild`, from its own session's log
 * header), or came from a build before chat records (a 1.x task the layout
 * migration made into a chat, or a chat on a `chat.db`, still there or set
 * aside on this computer). Reads no further than the first sign, and only
 * the first line of each chat's logs.
 */
export function workspaceTestedBefore({
  machineDir,
  workspacePath,
}: {
  machineDir: string;
  workspacePath: string;
}): boolean {
  const { chatsDir, setAsideDir } = workspaceLayout(workspacePath);
  if (
    hasEntries(path.join(setAsideDir, TASK_RECORDS_SET_ASIDE)) ||
    hasEntries(path.join(machineDir, SET_ASIDE_CHAT_DB)) ||
    hasLegacyTask(path.join(workspacePath, TASKS_DIR_NAME))
  ) {
    return true;
  }
  return entries(chatsDir).some((chat) =>
    chatFromTestBuild(path.join(chatsDir, chat)),
  );
}

function chatFromTestBuild(chatDir: string): boolean {
  const names = entries(chatDir);
  if (names.includes(CHAT_DB_FILE_NAME)) {
    return true;
  }
  for (const name of names) {
    if (!LOG_NAME.test(name)) {
      continue;
    }
    const header = readHeader(path.join(chatDir, name));
    // A task's header says which build started the task; the chat's own
    // session, the one with no parent, says which started the chat.
    if (header !== undefined && header.parent === undefined) {
      return isTestBuild(header.app);
    }
  }
  return false;
}

function readHeader(
  logPath: string,
): undefined | z.output<typeof HeaderSchema> {
  let fd: number | undefined;
  try {
    fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const end = text.indexOf("\n");
    const parsed = HeaderSchema.safeParse(
      JSON.parse(end === -1 ? text : text.slice(0, end)),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Unreadable, not downloaded, or not a header: says nothing.
    return undefined;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

/** A task 1.x left at the workspace's top level that no migration has moved yet. */
function hasLegacyTask(tasksDir: string): boolean {
  return entries(tasksDir).some((task) => {
    const privateDir = path.join(tasksDir, task, PRIVATE_FOLDER_NAME);
    return (
      fs.existsSync(path.join(privateDir, SETTINGS_FILE_NAME)) ||
      fs.existsSync(path.join(privateDir, LEGACY_TASK_DB_FILE_NAME))
    );
  });
}

function hasEntries(dir: string): boolean {
  return entries(dir).length > 0;
}

function entries(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
