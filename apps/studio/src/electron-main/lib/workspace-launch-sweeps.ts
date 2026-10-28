import {
  noteChatsLeftBehind,
  noteStartedOver,
} from "@/electron-main/lib/notices";
import {
  type ChatRecordsSplit,
  convertAppsToAppFiles,
  convertChatSettingsFiles,
  convertTopicsToTopicFiles,
  type DeviceId,
  type FolderMoved,
  giveChatsTheirFolders,
  migrateWorkspaceLayout,
  moveAppsToFolder,
  moveMemoriesToFolder,
  moveSkillsToFolder,
  moveTopicFolders,
  moveTopicsToFolder,
  renameChatDatabases,
  settleDrafts,
  settleKeyFolderCase,
  settleWorkspaceDb,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { app, shell } from "electron";

import { appConnectionStore } from "../stores/workspace/app-connections";
import { captureServerException } from "./capture-server-exception";
import { convertChatRecords } from "./convert-chat-records";
import { logger } from "./electron-logger";
import {
  workspaceMachineDir,
  workspaceWorkFoldersDir,
} from "./get-workspace-folder";
import { getOpenedWithoutRecords } from "./workspace-run";
import { workspaceLayoutMarks } from "./workspaces";

/**
 * The launch's sweeps over the workspace folder, in order, before the
 * workspace starts: what earlier builds left is brought into the shape this
 * build reads, every chat is put on its records, and the person's own
 * folders come out of `.instrument/`. Reads the workspace the launch
 * resolved (`placeRun`) for its machine and work folders. Each
 * step is idempotent and none blocks the launch.
 */
export async function sweepWorkspaceFolder({
  deviceId,
  inAppData,
  rootDir,
}: {
  deviceId: DeviceId;
  /**
   * Whether the workspace is in the app's own data, where 1.x and the 2.0
   * betas kept every workspace; the layout sweeps run only there.
   */
  inAppData: boolean;
  rootDir: string;
}): Promise<void> {
  // Which database a chat opens is settled for every workspace, before
  // anything reads one: a chat whose own store holds none of its conversation
  // opens empty while the whole of it sits in the file beside it, and nothing
  // else names them. The sweep names them again once it has moved the app's
  // folders in, where a chat an earlier build left at the workspace's top
  // level is not in its place yet when this runs.
  nameChatDatabases(rootDir);

  const startedOver = getOpenedWithoutRecords();
  if (startedOver !== undefined) {
    noteStartedOver(startedOver);
  }

  // The layout sweeps bring what 1.x and the 2.0 betas left into the shape
  // this build reads. They run only on a workspace in the app's own data,
  // where those builds kept every workspace: a folder the person picked was
  // never one, its top level is theirs, and a workspace moved there had its
  // sweeps finished first.
  if (inAppData) {
    sweepWorkspaceLayout(rootDir);
  } else {
    logger.info(
      "Workspace layout migration: none for a folder the person picked",
    );
  }
  settleDatabase(rootDir);
  // Before the workspace starts, which puts in place the writer every write
  // to a chat's store appends through: a chat whose conversation is still in
  // its `chat.db` has to be on its records before one can reach them.
  const converted = await convertChatDatabases(deviceId, rootDir);
  // Then what each chat's `settings.json` held goes where this build keeps
  // it, from the records just converted, before anything reads a chat.
  await convertChatSettings(deviceId, rootDir);
  // A folder of the six under another case (`skills/`, which a build before
  // kept there) is the one each step below finds under the app's name on a
  // file system that reads both as one, so it takes that name first.
  for (const step of settleKeyFolderCase(rootDir)) {
    logger.info(`Folder case: ${step}`);
  }
  // The person's own folders come out of `.instrument/` before anything
  // reads one of them.
  await moveFolderOut("Memory", () => moveMemoriesToFolder(rootDir));
  await moveFolderOut("Skills", () => moveSkillsToFolder(rootDir));
  await moveFolderOut("Topics", () => moveTopicsToFolder(rootDir));
  await moveFolderOut("Apps", () => moveAppsToFolder(rootDir));
  // And once the topics and the apps are out, each one's files become the one
  // file a person reads, which is its own step: the folder moves whatever is
  // inside it, and one already converted is left alone.
  await convertTopicFiles(rootDir);
  // Once every topic is its `TOPIC.md`, the folders an earlier build granted
  // in one come onto this computer's permission settings, before the moves
  // below rewrite the paths those settings hold.
  carryTopicFolders(rootDir);
  await convertAppFiles(rootDir);
  // Then each chat the converter just brought onto its records gets the
  // folder a person opens, written once. After the topics, because a
  // transcript names the topic its chat is filed under. No other chat is
  // read here: a chat's folder is written when its turn ends or the person
  // sends it a message.
  await writeConvertedChatFolders(rootDir, converted);
  // And the drafts move out to `Drafts/`, where a send the app was
  // interrupted partway through is finished from the records just converted.
  await settleWorkspaceDrafts(rootDir);
}

function settleDatabase(rootDir: string) {
  try {
    const settled = settleWorkspaceDb({
      machineDir: workspaceMachineDir(),
      rootDir,
    });
    for (const step of settled.done) {
      logger.info(`Workspace database: ${step}`);
    }
    if (settled.failed > 0) {
      logger.warn(
        `Left ${settled.failed} workspace database step${settled.failed === 1 ? "" : "s"} for the next boot`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Give each chat the database that holds its conversation, before the
 * workspace opens one. Runs for every workspace, a folder the person picked
 * included, where the rest of the sweep runs only on one in the app's own
 * data. Idempotent; a failure must not block boot.
 */
function nameChatDatabases(rootDir: string) {
  try {
    reportChatRecords(renameChatDatabases(rootDir));
  } catch (error) {
    captureServerException(error);
  }
}

/** What naming a chat's database, or splitting its records, did. */
function reportChatRecords(records: ChatRecordsSplit) {
  logDone("Chat records", records.done);
  if (records.failed > 0) {
    logger.warn(
      `Left ${records.failed} chat entr${records.failed === 1 ? "y" : "ies"} to move on the next boot`,
    );
  }
}

/**
 * Says how many steps a sweep took, naming only the ones that went wrong. A
 * chat's id spells out its title and the log goes out with every report, so
 * a launch that converts hundreds of chats would otherwise send each one's
 * name; a step that left something behind is still said whole, since that
 * is the line a fix needs.
 */
function logDone(sweep: string, done: readonly string[]) {
  const problems = done.filter((step) => /^left |\bcould not\b/.test(step));
  const moved = done.length - problems.length;
  if (moved > 0) {
    logger.info(`${sweep}: ${moved} step${moved === 1 ? "" : "s"} done`);
  }
  for (const step of problems) {
    logger.info(`${sweep}: ${step}`);
  }
}

/**
 * Bring the folders granted under each topic out of its `TOPIC.md` and into
 * this computer's permission settings, once per computer. A failure must not
 * block boot; one before the settings are written is tried again next launch.
 */
function carryTopicFolders(rootDir: string) {
  try {
    const { moved } = moveTopicFolders({
      machineDir: workspaceMachineDir(),
      rootDir,
    });
    if (moved > 0) {
      logger.info(
        `Topic folders: moved ${moved} topic${moved === 1 ? "" : "s"}' folders onto this computer's settings`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Put every chat on its records before anything opens one, and set the
 * database each was converted from aside on this computer. Runs after the
 * databases are named, so a chat whose conversation is in the file beside
 * its own store converts from the one that holds it. Idempotent, and a chat
 * it could not convert keeps its database and is said back; a failure must
 * not block boot. Answers with the chats converted at this launch.
 */
async function convertChatDatabases(
  deviceId: DeviceId,
  rootDir: string,
): Promise<string[]> {
  try {
    const converted = await convertChatRecords({
      appVersion: app.getVersion(),
      deviceId,
      machineDir: workspaceMachineDir(),
      rootDir,
    });
    logDone("Chat records", converted.done);
    for (const { reason, where } of converted.left) {
      logger.warn(
        `Chat records: left ${where} on its database and will try again next launch: ${reason}`,
      );
    }
    // A chat left behind opens with nothing in it while its conversation
    // sits in the database beside it, so the bell says so rather than
    // leaving the person to wonder where it went.
    noteChatsLeftBehind(converted.left.length);
    return converted.converted;
  } catch (error) {
    captureServerException(error);
    return [];
  }
}

/**
 * Carry what each chat's `settings.json` held to where this build keeps it.
 * Runs after the database converter, since a chat's settings land on its
 * records; a chat still on its database keeps its file for the next launch.
 * Idempotent, and a failure must not block boot.
 */
async function convertChatSettings(deviceId: DeviceId, rootDir: string) {
  try {
    const converted = await convertChatSettingsFiles({
      chatsDir: workspaceLayout(rootDir).chatsDir,
      deviceId,
      machineDir: workspaceMachineDir(),
    });
    logDone("Chat settings", converted.done);
    for (const { reason, where } of converted.left) {
      logger.warn(
        `Chat settings: left ${where} for the next launch: ${reason}`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Give each chat the converter just brought onto its records the folder a
 * person opens, `Chats/<title>/`, with its transcript written from those
 * records. Only those chats, and only at the launch that converted them, so
 * a launch after it reads no chat at all. A failure must not block boot; the
 * chat's next turn or message writes its folder anyway.
 */
async function writeConvertedChatFolders(
  rootDir: string,
  chats: readonly string[],
) {
  if (chats.length === 0) {
    return;
  }
  try {
    const startedAt = performance.now();
    const written = await giveChatsTheirFolders(
      rootDir,
      workspaceMachineDir(),
      chats,
    );
    logger.info(
      `Chat folders: wrote ${written.filter((chat) => chat.kind === "written").length} for the chats just converted, in ${Math.round(performance.now() - startedAt)}ms`,
    );
    for (const chat of written) {
      if (chat.kind === "failed") {
        logger.warn(`Chat folders: ${chat.id} has none: ${chat.error}`);
      }
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Move the drafts an earlier build hid in the workspace's `.instrument/` out
 * to `Drafts/`, and finish any send the app was interrupted partway through:
 * a draft whose chat already holds the message naming it was sent, and only
 * its folder was left behind. Runs after the converter, so that message can
 * be read. Idempotent; a failure must not block boot.
 */
async function settleWorkspaceDrafts(rootDir: string) {
  try {
    const { finished, moved } = await settleDrafts(rootDir, {
      moveToTrash: (target) => shell.trashItem(target),
    });
    for (const step of moved.done) {
      logger.info(`Drafts: ${step}`);
    }
    for (const { reason, where } of moved.left) {
      logger.warn(`Drafts: left ${where} where it is: ${reason}`);
    }
    if (finished.finished.length > 0) {
      logger.info(
        `Drafts: finished sending ${finished.finished.join(", ")}, whose messages were already written`,
      );
    }
    for (const { path: where, reason } of finished.untrashed) {
      logger.warn(`Drafts: left ${where} where it is: ${reason}`);
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Move the memories an earlier build hid in the workspace's `.instrument/`
 * out to `Memory/`, where the person can read and edit them. Runs for every
 * workspace, since every build so far hid them wherever the workspace was
 * kept. Idempotent, and a workspace that already holds `Memory/` is left
 * alone; a failure must not block boot.
 */
async function moveFolderOut(what: string, move: () => Promise<FolderMoved>) {
  try {
    const moved = await move();
    switch (moved.kind) {
      case "already-there":
        logger.info(
          `${what}: ${moved.where} is already there, so nothing moved`,
        );
        break;
      case "failed":
        logger.warn(
          `${what}: left where it was, and the next launch tries again: ${moved.error}`,
        );
        break;
      case "moved":
        logger.info(`${what}: moved ${moved.count} to ${moved.where}`);
        break;
      case "none":
        break;
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Turn each topic's hidden settings and instructions into the one `TOPIC.md`
 * a person reads and edits. Runs after the folder itself is out, for every
 * workspace, since every build so far wrote the two files. Idempotent, and a
 * topic that already has its file is left alone; a failure must not block
 * boot.
 */
async function convertTopicFiles(rootDir: string) {
  try {
    const converted = await convertTopicsToTopicFiles(rootDir);
    for (const line of converted.done) {
      logger.info(`Topics: ${line}`);
    }
    for (const left of converted.left) {
      logger.warn(
        `Topics: left ${left.where} as it was, and the next launch tries again: ${left.reason}`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Turn each app's manifest and guide into the one `APP.md` a person reads and
 * edits, in a folder named for the app. Runs after the folder itself is out,
 * for every workspace rather than only one in the app's own data, and carries
 * each connected app's approval onto the manifest as this build hashes it, so
 * nothing is asked for again. Idempotent; a failure must not block boot.
 */
async function convertAppFiles(rootDir: string) {
  try {
    const converted = await convertAppsToAppFiles(rootDir, {
      connections: appConnectionStore,
    });
    for (const line of converted.done) {
      logger.info(`Apps: ${line}`);
    }
    for (const left of converted.left) {
      logger.warn(
        `Apps: left ${left.where} as it was, and the next launch tries again: ${left.reason}`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Move the app's folders into the workspace's `.instrument/`, normalize the
 * on-disk layout of any legacy tasks, and take each chat's work out of its
 * records, before the workspace reads them. Idempotent; a failure must not
 * block boot.
 */
function sweepWorkspaceLayout(rootDir: string) {
  try {
    const migrationStartedAt = performance.now();
    const migration = migrateWorkspaceLayout({
      machineDir: workspaceMachineDir(),
      marks: workspaceLayoutMarks(rootDir),
      rootDir,
      workFoldersDir: workspaceWorkFoldersDir(),
    });
    logger.info(
      `Workspace layout migration: ${Math.round(performance.now() - migrationStartedAt)}ms`,
    );
    for (const step of migration.appFolders.done) {
      logger.info(`App folders: ${step}`);
    }
    if (migration.appFolders.failed > 0) {
      logger.warn(
        `Left ${migration.appFolders.failed} app folder entr${migration.appFolders.failed === 1 ? "y" : "ies"} to move on the next boot`,
      );
    }
    if (migration.movedTaskCount > 0) {
      logger.info(`Migrated ${migration.movedTaskCount} task(s) to tasks/`);
    }
    if (migration.legacyTasks.adoptedCount > 0) {
      logger.info(
        `Made ${migration.legacyTasks.adoptedCount} earlier task(s) into chats, set aside ${migration.legacyTasks.emptyCount} empty one(s), and wrote ${migration.legacyTasks.topicCount} topic(s) from projects`,
      );
    }
    if (migration.legacyTasks.leftOver > 0) {
      logger.warn(
        `Left ${migration.legacyTasks.leftOver} earlier task(s) or project(s) to move on the next boot`,
      );
    }
    for (const task of migration.legacyTasks.unreadable) {
      logger.warn(
        `Left the earlier task in ${task} where it is: its database could not be read`,
      );
    }
    reportChatRecords(migration.chatRecords);
    if (migration.removedBrowserProfileCloneCount > 0) {
      logger.info(
        `Deleted ${migration.removedBrowserProfileCloneCount} leftover browser profile clone(s)`,
      );
    }
    if (migration.conflictedTaskIds.length > 0) {
      // A legacy task was abandoned because tasks/<id> already exists. The
      // marker means this won't retry, so the leftover copy lingers in
      // projects/ -- surface it.
      logger.warn(
        "Workspace layout migration left legacy task copies in projects/ (id already exists under tasks/)",
        { conflictedTaskIds: migration.conflictedTaskIds },
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}
