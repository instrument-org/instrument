import {
  CHAT_DB_FILE_NAME,
  type ChatConversion,
  convertWorkspaceChats,
  type DeviceId,
  entryExists,
  moveEntrySync,
  type WorkspaceConversion,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import path from "node:path";

import {
  readWorkspaceIdentityToChange,
  WORKSPACE_FORMAT_VERSION,
  writeWorkspaceIdentity,
} from "./workspaces";

/**
 * Where a converted chat's database goes, in the workspace's folder on this
 * computer: out of the workspace, which may be in a synced folder, and named
 * by the chat it was. Whether these copies are ever deleted is a later
 * release's call.
 */
const SET_ASIDE_CHAT_DB = path.join("set-aside", "chat-db");

/**
 * What one launch did to put every chat on its records, one line per step
 * for the log, and how many chats are still on a `chat.db`.
 */
export interface ChatRecordsConverted {
  /**
   * The chats that moved onto their records at this launch, by the name of
   * each one's record folder. A chat is named here once: the next launch
   * finds it already converted.
   */
  converted: string[];
  done: string[];
  /** Chats left on their database, each with why, for the log to warn about. */
  left: { reason: string; where: string }[];
}

/**
 * Turn each chat's `chat.db` into the records the workspace reads, before
 * anything opens a chat: the workspace puts the writer beside the store in
 * place as it starts, and a chat whose conversation is still in its database
 * would then take a session header and nothing else.
 *
 * Per chat, in order: write and verify the records, move the database out of
 * the workspace, and only once every chat holds its records mark the folder
 * as converted and raise its format version, so a build that reads a chat
 * only from its `chat.db` refuses the folder (`workspace-refusal.ts`) rather
 * than showing empty chats.
 *
 * A chat whose records would not read back as its database does keeps the
 * database, is said back, and is tried again at the next launch, which costs
 * that chat alone: every chat that converted has no database left, so the
 * run over it is a listing of its folder.
 *
 * Safe to run on every launch, and never throws: the workspace opens either
 * way, reading a converted chat from its records and any other from its
 * database.
 */
export async function convertChatRecords({
  appVersion,
  convert = convertWorkspaceChats,
  deviceId,
  machineDir,
  rootDir,
}: {
  appVersion: string;
  /**
   * The conversion itself, which the workspace package owns and tests. A seam
   * so that what the app does around it -- what it sets aside, what it marks,
   * what it leaves for the next launch -- is tested against each outcome the
   * conversion can report rather than against a folder built to produce one.
   */
  convert?: typeof convertWorkspaceChats;
  deviceId: DeviceId;
  machineDir: string;
  rootDir: string;
}): Promise<ChatRecordsConverted> {
  const converted: ChatRecordsConverted = {
    converted: [],
    done: [],
    left: [],
  };
  const chatsDir = workspaceLayout(rootDir).chatsDir;
  // A workspace with no chats folder has no chat on a database, which is all
  // the mark below says, so it is marked as a workspace whose every chat
  // converted is.
  if (entryExists(chatsDir)) {
    const startedAt = performance.now();
    const conversion = await convert(chatsDir, {
      app: appVersion,
      deviceId,
    });
    const { counts } = conversion;
    converted.done.push(
      `converted ${counts.converted} chat(s) and found ${counts["already-converted"] + counts["no-store"]} already on their records, in ${Math.round(performance.now() - startedAt)}ms`,
    );
    for (const chat of conversion.chats) {
      if (chat.kind === "converted") {
        converted.converted.push(path.basename(chat.dir));
      }
      const reason = whyNotConverted(chat);
      if (reason !== undefined) {
        converted.left.push({ reason, where: path.basename(chat.dir) });
      }
    }

    setAsideStores({ converted, conversion, machineDir });

    if (!conversion.complete) {
      return converted;
    }
  }

  markConverted(converted, rootDir);
  return converted;
}

/**
 * Why a chat was not converted, or nothing for one that holds its records.
 * A difference names where it is, which is enough to find it in the chat.
 */
function whyNotConverted(
  chat: { dir: string } & ChatConversion,
): string | undefined {
  switch (chat.kind) {
    case "different":
      return `the records would not read back as its database does, at ${where(chat.differences)}`;
    case "failed":
    case "unreadable":
      return chat.error;
    case "half-written":
      return `its records hold turns taken before this ran, and its database a history they do not, at ${where(chat.differences)}`;
    default:
      return undefined;
  }
}

function where(differences: { path: string }[]): string {
  const first = differences.slice(0, 3).map((one) => one.path);
  return differences.length > first.length
    ? `${first.join(", ")} and ${differences.length - first.length} more`
    : first.join(", ");
}

/**
 * Moves each converted chat's database and the files beside it out of the
 * workspace. A move that fails leaves the database where it is, which the
 * next launch tries again: the chat reads from its records either way.
 */
function setAsideStores({
  converted,
  conversion,
  machineDir,
}: {
  converted: ChatRecordsConverted;
  conversion: WorkspaceConversion;
  machineDir: string;
}): void {
  const asideDir = path.join(machineDir, SET_ASIDE_CHAT_DB);
  let moved = 0;
  let failed = 0;
  for (const chat of conversion.chats) {
    if (chat.kind !== "converted" && chat.kind !== "already-converted") {
      continue;
    }
    const chatId = path.basename(chat.dir);
    for (const file of chat.store) {
      // `chat.db`, and its `-wal`, `-shm` or `-journal`, under the id of the
      // chat whose conversation it held.
      const aside = `${chatId}.db${path.basename(file).slice(CHAT_DB_FILE_NAME.length)}`;
      try {
        moveEntrySync(file, path.join(asideDir, aside));
        moved += 1;
      } catch (error) {
        failed += 1;
        converted.done.push(
          `could not move ${file} out of the workspace (${String(error)}); left it there`,
        );
      }
    }
  }
  if (moved > 0) {
    converted.done.push(`set ${moved} converted chat database(s) aside`);
  }
  if (failed > 0) {
    converted.done.push(
      `left ${failed} converted chat database(s) in the workspace for the next launch`,
    );
  }
}

/**
 * Says in `workspace.json` that every chat is on its records, and raises the
 * folder's format version with it, which is what an older build reads to
 * refuse the folder. Written once: a launch that finds both already there
 * writes nothing.
 */
function markConverted(converted: ChatRecordsConverted, rootDir: string): void {
  const identity = readWorkspaceIdentityToChange(rootDir);
  if (
    identity.chatRecordsConverted === true &&
    identity.formatVersion >= WORKSPACE_FORMAT_VERSION
  ) {
    return;
  }
  try {
    writeWorkspaceIdentity(rootDir, {
      ...identity,
      chatRecordsConverted: true,
      formatVersion: WORKSPACE_FORMAT_VERSION,
    });
    converted.done.push(
      `every chat is on its records, workspace at format version ${WORKSPACE_FORMAT_VERSION.toString()}`,
    );
  } catch (error) {
    converted.done.push(
      `could not mark the workspace converted (${String(error)}); the next launch tries again`,
    );
  }
}
