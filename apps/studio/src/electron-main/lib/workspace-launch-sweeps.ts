import {
  noteChatsLeftBehind,
  noteStartedOver,
} from "@/electron-main/lib/notices";
import {
  type ChatRecordsSplit,
  convertAppsToAppFiles,
  convertChatSettingsFiles,
  convertProjectsToProjectFiles,
  type DeviceId,
  FILES_FOLDER_NAME,
  type FolderMoved,
  markedWhereNoSettings,
  migrateWorkspaceLayout,
  moveAppsToFolder,
  moveMemoriesToFolder,
  moveSkillsToFolder,
  moveProjectFolders,
  moveProjectsToFolder,
  moveTopicsToProjects,
  renameChatDatabases,
  retireChatsFolder,
  settleDrafts,
  settleKeyFolderCase,
  settleMemoryFiles,
  settleProjectFiles,
  withholdChats,
  settleWorkspaceDb,
  writeDataDirReadme,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { app, shell } from "electron";
import path from "node:path";

import { appConnectionStore } from "../stores/workspace/app-connections";
import { timeBootStep } from "./boot-timing";
import { captureServerException } from "./capture-server-exception";
import { convertChatRecords } from "./convert-chat-records";
import { logger } from "./electron-logger";
import {
  getUserDataDir,
  workspaceMachineDir,
  workspaceWorkFoldersDir,
} from "./get-workspace-folder";
import { getOpenedWithoutRecords } from "./workspace-run";
import { appDataOutputFolder, workspaceLayoutMarks } from "./workspaces";

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
  //
  // First, a build that called projects topics kept them in `Topics/`, each
  // in a `TOPIC.md`, and they come into `Projects/` before anything reads one,
  // the 1.x migration included, which finds a 1.x project's earlier project
  // there.
  await timeBootStep("sweep.moveTopicsToProjects", () =>
    moveTopicsToProjectsFolder(rootDir),
  );
  // Whether a build before this one kept permission settings here is read
  // before the steps below, which write them.
  markProjectFoldersSeen();
  let layoutSettled = true;
  if (inAppData) {
    layoutSettled = sweepWorkspaceLayout(deviceId, rootDir);
  } else {
    logger.info(
      "Workspace layout migration: none for a folder the person picked",
    );
  }
  await timeBootStep("sweep.settleDatabase", () => settleDatabase(rootDir));
  // Before the workspace starts, which puts in place the writer every write
  // to a chat's store appends through: a chat whose conversation is still in
  // its `chat.db` has to be on its records before one can reach them.
  await timeBootStep("sweep.convertChatDatabases", () =>
    convertChatDatabases(deviceId, rootDir),
  );
  // Then what each chat's `settings.json` held goes where this build keeps
  // it, from the records just converted, before anything reads a chat.
  await timeBootStep("sweep.convertChatSettings", () =>
    convertChatSettings(deviceId, rootDir),
  );
  // A folder of the six under another case (`skills/`, which a build before
  // kept there) is the one each step below finds under the app's name on a
  // file system that reads both as one, so it takes that name first. Not
  // while the layout sweep still has a folder to move in: it finds `chats/`
  // and `projects/` by the lowercase names earlier builds wrote, and one
  // renamed here is one it never finds again.
  if (layoutSettled) {
    for (const step of settleKeyFolderCase(rootDir)) {
      logger.info(`Folder case: ${step}`);
    }
  } else {
    logger.warn(
      "Folder case: left as it is until the layout sweep has moved every folder",
    );
  }
  // The person's own folders come out of `.instrument/` before anything
  // reads one of them.
  await moveFolderOut("Memory", () => moveMemoriesToFolder(rootDir));
  // Then each memory file becomes its text alone, what an earlier build
  // wrote over it going into the memory store.
  await timeBootStep("sweep.settleMemoryFiles", () =>
    settleMemoryFolder(deviceId, rootDir),
  );
  await moveFolderOut("Skills", () => moveSkillsToFolder(rootDir));
  await moveFolderOut("Projects", () => moveProjectsToFolder(rootDir));
  await moveFolderOut("Apps", () => moveAppsToFolder(rootDir));
  // And once the projects and the apps are out, each one's files become what
  // this build reads, which is its own step: the folder moves whatever is
  // inside it, and one already converted is left alone.
  await timeBootStep("sweep.convertProjectFiles", () =>
    convertProjectFiles(deviceId, rootDir),
  );
  // Then every project has its record, and its `AGENTS.md` is its
  // instructions alone: what an earlier build, here or on another computer,
  // wrote over them goes into the projects store.
  await timeBootStep("sweep.settleProjectFiles", () => {
    settleProjects(deviceId, rootDir);
  });
  // The folders an earlier build granted in a project's file come onto this
  // computer's permission settings, before the moves below rewrite the paths
  // those settings hold.
  carryProjectFolders(deviceId, rootDir);
  await timeBootStep("sweep.convertAppFiles", () => convertAppFiles(rootDir));
  // The `Chats/` an earlier build kept, a folder per chat, empties into the
  // places this build keeps those things, once every chat is on its records,
  // which take back what the person sent.
  await timeBootStep("sweep.retireChatsFolder", () =>
    emptyChatsFolder({ deviceId, inAppData, rootDir }),
  );
  // And the drafts come into `.instrument/drafts/`, where a send the app was
  // interrupted partway through is finished from the records just converted.
  await timeBootStep("sweep.settleWorkspaceDrafts", () =>
    settleWorkspaceDrafts(rootDir),
  );
  // Last, the guide for another coding agent opened in the workspace, once
  // `.instrument/` is in this build's shape.
  await timeBootStep("sweep.writeDataDirReadme", () => writeGuide(rootDir));
}

/**
 * Write `.instrument/README.md` where it differs from this build's guide.
 * A failure must not block boot.
 */
async function writeGuide(rootDir: string) {
  try {
    if (await writeDataDirReadme(rootDir)) {
      logger.info("Wrote the workspace guide in .instrument/README.md");
    }
  } catch (error) {
    captureServerException(error);
  }
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
 * Bring the folders granted under each project out of its `AGENTS.md` and
 * into this computer's permission settings, once per computer. A failure must
 * not block boot; one before the settings are written is tried again next
 * launch.
 */
function markProjectFoldersSeen() {
  try {
    markedWhereNoSettings(workspaceMachineDir());
  } catch (error) {
    captureServerException(error);
  }
}

function carryProjectFolders(deviceId: DeviceId, rootDir: string) {
  try {
    const { moved } = moveProjectFolders({
      device: deviceId,
      machineDir: workspaceMachineDir(),
      rootDir,
    });
    if (moved > 0) {
      logger.info(
        `Project folders: moved ${moved} project${moved === 1 ? "" : "s"}' folders onto this computer's settings`,
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
 * not block boot.
 */
async function convertChatDatabases(deviceId: DeviceId, rootDir: string) {
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
    // A chat whose conversation sits in the database alone would open with
    // nothing in it, and a message sent there would keep every later launch
    // from converting it, so it stays out of the list until one does, and
    // the bell says so rather than leaving the person to wonder where it
    // went.
    withholdChats(converted.onDatabaseAlone);
    noteChatsLeftBehind(converted.left.length);
  } catch (error) {
    captureServerException(error);
    withholdChats([]);
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
 * Empty the `Chats/` an earlier build kept into the chats' records and the
 * Files folder, for every workspace, a folder the person picked included.
 * Idempotent, and a failure must not block boot; what is left the next
 * launch tries again.
 */
async function emptyChatsFolder({
  deviceId,
  inAppData,
  rootDir,
}: {
  deviceId: DeviceId;
  inAppData: boolean;
  rootDir: string;
}) {
  try {
    const retired = await retireChatsFolder({
      device: deviceId,
      filesDir: path.join(
        workspaceOutputDir({ inAppData, rootDir }),
        FILES_FOLDER_NAME,
      ),
      machineDir: workspaceMachineDir(),
      rootDir,
    });
    if (retired.moved + retired.deleted + retired.returned > 0) {
      logger.info(
        `Chats folder: moved ${retired.moved} to Files, deleted ${retired.deleted} with only a transcript, put ${retired.returned} sent files and notes back in their chats`,
      );
    }
    for (const { reason, where } of retired.left) {
      logger.warn(
        `Chats folder: left ${where} where it is, and the next launch tries again: ${reason}`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Where a workspace's finished work goes, the config's `outputDir`: the
 * folder the person picked, and for a workspace in the app's own data the
 * flavor's Instrument folder in the home folder (or a driven fixture's own).
 */
function workspaceOutputDir({
  inAppData,
  rootDir,
}: {
  inAppData: boolean;
  rootDir: string;
}): string {
  return inAppData ? appDataOutputFolder(getUserDataDir()) : rootDir;
}

/**
 * Move the drafts a build before kept in the top-level `Drafts/` into
 * `.instrument/drafts/`, convert the ones an early beta left there in its own
 * shape, and finish any send the app was interrupted partway through:
 * a draft whose chat already holds the message naming it was sent, and only
 * its folder was left behind. Runs after the converter, so that message can
 * be read. Idempotent; a failure must not block boot.
 */
async function settleWorkspaceDrafts(rootDir: string) {
  try {
    const { converted, finished, movedIn } = await settleDrafts(
      { machineDir: workspaceMachineDir(), rootDir },
      { moveToTrash: (target) => shell.trashItem(target) },
    );
    for (const moved of [movedIn, converted]) {
      for (const step of moved.done) {
        logger.info(`Drafts: ${step}`);
      }
      for (const { reason, where } of moved.left) {
        logger.warn(`Drafts: left ${where} where it is: ${reason}`);
      }
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
    const moved = await timeBootStep(`sweep.move${what}`, move);
    switch (moved.kind) {
      case "already-there":
        logger.warn(
          `${what}: left ${moved.left} hidden, since ${moved.where} already has one of each name`,
        );
        break;
      case "failed":
        logger.warn(
          `${what}: left where it was, and the next launch tries again: ${moved.error}`,
        );
        break;
      case "moved":
        logger.info(
          `${what}: moved ${moved.count} to ${moved.where}${moved.left > 0 ? `, and left ${moved.left} hidden` : ""}`,
        );
        break;
      case "none":
        break;
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Turn each project's hidden settings and instructions into its record and
 * the `AGENTS.md` a person reads and edits. Runs after the folder itself is
 * out, for every workspace, since every build so far wrote the two files.
 * Idempotent, and a project that already has its file is left alone; a
 * failure must not block boot.
 */
async function convertProjectFiles(deviceId: DeviceId, rootDir: string) {
  try {
    logProjectSteps(await convertProjectsToProjectFiles(rootDir, deviceId));
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Take what earlier builds wrote over each project's instructions into the
 * projects store, and give every project folder its record. Every launch,
 * every workspace, since an earlier build on another computer writes it
 * back; a failure must not block boot, and the next launch tries again.
 */
function settleProjects(deviceId: DeviceId, rootDir: string) {
  try {
    logProjectSteps(settleProjectFiles(rootDir, deviceId));
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Take what earlier builds wrote over each memory into the memory store,
 * leaving each file its text. Every launch, every workspace; a failure must
 * not block boot, and the next launch tries again.
 */
async function settleMemoryFolder(deviceId: DeviceId, rootDir: string) {
  try {
    const settled = await settleMemoryFiles(rootDir, deviceId);
    logDone("Memory", settled.done);
    for (const each of settled.left) {
      logger.warn(
        `Memory: left ${each.where} as it was, and the next launch tries again: ${each.reason}`,
      );
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * Bring a build's `Topics/` into `Projects/`, each `TOPIC.md` becoming the
 * project's `AGENTS.md`. Every launch, every workspace; a failure must not
 * block boot, and the next launch tries again.
 */
async function moveTopicsToProjectsFolder(rootDir: string) {
  try {
    logProjectSteps(await moveTopicsToProjects(rootDir));
  } catch (error) {
    captureServerException(error);
  }
}

function logProjectSteps({
  done,
  left,
}: {
  done: string[];
  left: { reason: string; where: string }[];
}) {
  for (const line of done) {
    logger.info(`Projects: ${line}`);
  }
  for (const each of left) {
    logger.warn(
      `Projects: left ${each.where} as it was, and the next launch tries again: ${each.reason}`,
    );
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
 * block boot. Says whether every app folder is where this build reads it,
 * which is false when a move was left for the next boot or the sweep threw.
 */
function sweepWorkspaceLayout(deviceId: DeviceId, rootDir: string): boolean {
  try {
    const migrationStartedAt = performance.now();
    const migration = migrateWorkspaceLayout({
      device: deviceId,
      machineDir: workspaceMachineDir(),
      filesDir: path.join(
        appDataOutputFolder(getUserDataDir()),
        FILES_FOLDER_NAME,
      ),
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
        `Made ${migration.legacyTasks.adoptedCount} earlier task(s) into chats, set aside ${migration.legacyTasks.emptyCount} empty one(s), and wrote ${migration.legacyTasks.projectCount} project(s) from 1.x projects`,
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
    return migration.appFolders.failed === 0;
  } catch (error) {
    captureServerException(error);
    return false;
  }
}
