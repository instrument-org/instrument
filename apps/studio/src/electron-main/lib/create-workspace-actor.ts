import { refreshExpiredTokens } from "@/electron-main/lib/chatgpt-account";
import { getAIProviderConfigs } from "@/electron-main/lib/get-ai-provider-configs";
import { getSignedInUser } from "@/electron-main/lib/get-signed-in-user";
import {
  finderEntries,
  macHelperBinPath,
  seatbeltHelperPath,
  resolveAlias,
} from "@/electron-main/lib/mac-native";
import {
  isQuitGuardForcedInDev,
  requestQuit,
  startQuit,
} from "@/electron-main/lib/quit";
import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { is } from "@electron-toolkit/utils";
import { aiGatewayApp } from "@instrument-org/ai-gateway";
import createBashWorker from "@instrument-org/workspace/bash-worker?nodeWorker";
import {
  attachChats,
  BACKGROUND_PROCESS_TEARDOWN_MS,
  type ChatRecordsSplit,
  closeAllAgentBrowserSessions,
  type DeviceId,
  ensurePythonBase,
  giveChatsTheirFolders,
  interruptTasksForQuit,
  killAllBackgroundProcesses,
  migrateWorkspaceLayout,
  prepareBundledSkills,
  moveChatPermissions,
  renameChatDatabases,
  setBashWorkerFactory,
  settleWorkspaceDb,
  stopWorkspaceSkillWatcher,
  StoreRecords,
  warmBashWorker,
  workspaceMachine,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, dialog, shell } from "electron";
import ms from "ms";
import path from "node:path";
import { noop } from "radashi";
import { createActor, fromPromise } from "xstate";

import { createBrowserViewManager } from "../browser-view/manager";
import { flushKeptState } from "../stores/workspace/kept-state";
import { searchWeb } from "../platform-api/web-search";
import { createAppsConfig, rememberAppsDir } from "./apps";
import { captureServerException } from "./capture-server-exception";
import { convertChatRecords } from "./convert-chat-records";
import { logger } from "./electron-logger";
import {
  getWorkspaceFolder,
  machineDir,
  workspaceInAppData,
  workspaceMachineDir,
} from "./get-workspace-folder";
import { workspaceDbFileOf, workspaceLayoutMarks } from "./workspaces";
import { ensureOutputFolderIcon } from "./output-folder-icon";
import { isRefusedFile } from "./refused-files";
import { BROWSER_SESSIONS_CLOSE_MS, quitMachine } from "./quit-machine";
import { quitPrompt, runningJobNames } from "./quit-prompt";
import { getRegistryDir } from "./registry-dir";
import { quitExitCode } from "./relaunch";
import { getRuntimeDir, removeFormerRuntime } from "./runtime-dir";
import { windowsDriveNames } from "./windows-drives";
import {
  getPNPMBinPath,
  getUutilsDir,
  getUvBinPath,
} from "./setup-bin-directory";

const SYSTEM_SKILLS_DIR_NAME = "system-skills";

/**
 * What quit teardown allows the skills watcher on top of the slowest thing it
 * waits for. Enough that a background process taking its whole grace period
 * does not spend the watcher's budget as well.
 */
const QUIT_TEARDOWN_SLACK_MS = ms("2 seconds");
const UNPACKAGED_SYSTEM_SKILLS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace/system-skills",
);
export async function createWorkspaceActor(deviceId: DeviceId) {
  const rootDir = getWorkspaceFolder();

  // Which database a chat opens is settled for every workspace, before
  // anything reads one: a chat whose own store holds none of its conversation
  // opens empty while the whole of it sits in the file beside it, and nothing
  // else names them. The sweep names them again once it has moved the app's
  // folders in, where a chat an earlier build left at the workspace's top
  // level is not in its place yet when this runs.
  nameChatDatabases(rootDir);

  // The layout sweeps bring what 1.x and the 2.0 betas left into the shape
  // this build reads. They run only on a workspace in the app's own data,
  // where those builds kept every workspace: a folder the person picked was
  // never one, its top level is theirs, and a workspace moved there had its
  // sweeps finished first.
  const inAppData = workspaceInAppData();
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
  await convertChatDatabases(deviceId, rootDir);
  // Once every chat is on its records, each gets the folder a person opens,
  // written from them.
  await writeChatFolders(rootDir);

  // The build emits the worker as its own chunk. Every agent shell runs there,
  // off the thread that paints the window, unless INSTRUMENT_BASH_WORKER=0.
  setBashWorkerFactory(createBashWorker);
  warmBashWorker();

  const browserViewManager = createBrowserViewManager();

  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      apps: createAppsConfig(),
      appVersion: app.getVersion(),
      browser: browserViewManager.browser,
      captureException: captureServerException,
      deviceId,
      ...(process.platform === "win32"
        ? { driveNames: windowsDriveNames }
        : {}),
      ensureOutputFolderIcon,
      finderEntries,
      resolveAlias,
      // Files refuses what the viewers' file channel refuses, by one rule.
      isRefusedFile: (hostPath) => isRefusedFile(hostPath),
      macHelperBinPath: macHelperBinPath(),
      seatbeltHelperPath: seatbeltHelperPath(),
      getAIProviderConfigs,
      getUser: getSignedInUser,
      // This computer's folder, and in it the workspace's: where the
      // folder rules, the browser profile and the apps' servers are, which
      // the agent never reaches.
      machineDir: machineDir(),
      // In the workspace's machine folder rather than in the workspace: a
      // workspace may sit in a synced folder.
      workspaceDbFile: workspaceDbFileOf(workspaceMachineDir()),
      workspaceMachineDir: workspaceMachineDir(),
      knownFolders: {
        desktop: app.getPath("desktop"),
        documents: app.getPath("documents"),
        downloads: app.getPath("downloads"),
        music: app.getPath("music"),
        pictures: app.getPath("pictures"),
        videos: app.getPath("videos"),
      },
      modelCache: diskModelCache,
      nodeExecEnv: {
        // Required to allow Electron to operate as a node process
        // See https://www.electronjs.org/docs/latest/api/environment-variables
        ELECTRON_RUN_AS_NODE: "1",
      },
      // A folder the person picked is where their finished work goes too,
      // and only the app's own data ever held 1.x tasks.
      ...(inAppData ? { legacyTasks: true } : { outputDir: rootDir }),
      // Passwords and sign-ins stay out of every native command's reach.
      nativeSandbox: true,
      pnpmBinPath: getPNPMBinPath(),
      refreshExpiredCredentials: refreshExpiredTokens,
      registryDir: getRegistryDir(),
      rootDir,
      runtimeDir: getRuntimeDir(),
      systemSkillsDir: app.isPackaged
        ? path.join(process.resourcesPath, SYSTEM_SKILLS_DIR_NAME)
        : UNPACKAGED_SYSTEM_SKILLS_DIR,
      trashItem: (pathToTrash) => shell.trashItem(pathToTrash),
      uvBinPath: getUvBinPath(),
      uutilsDir: getUutilsDir(),
      webSearch: searchWeb,
    },
  });
  attachChats(actor);
  actor.start();

  const snapshot = actor.getSnapshot();
  if (snapshot.status === "error") {
    const error = new Error("Failed to create workspace actor", {
      cause: snapshot.error,
    });
    captureServerException(error, { scopes: ["studio"] });
    throw error;
  }

  const workspaceConfig = snapshot.context.config;
  rememberAppsDir(workspaceConfig.appsDir);
  // Here rather than beside the database converter: the chats are found
  // through the workspace's own folders, so this is the first point at which
  // there are any to read. Still after the converter, so a chat that failed
  // to convert has its permissions carried anyway; the two are independent,
  // and a chat left on its database is one the person is likely to open next.
  // Nothing has opened a chat yet, so nothing reads a grant before this.
  await carryChatPermissions();
  // In the background: a shell builds its mounts per command, so the bundled
  // skills appear in the shell for the first command after this lands. What
  // the runtime folder replaced goes once its skills are in place, the `bin`
  // links having been made before the workspace started.
  prepareBundledSkills(workspaceConfig)
    .catch((error: unknown) => {
      logger.warn("Could not prepare the bundled skills", error);
    })
    .then(() => removeFormerRuntime())
    .catch((error: unknown) => {
      logger.warn("Could not remove the former runtime folders", error);
    });
  // In the background too, so the first chart or spreadsheet a chat makes
  // finds its packages already there. Until it lands, `python` has what
  // `pip` installed; offline, the next chat's first Python use tries again.
  void ensurePythonBase().then((failure) => {
    if (failure) {
      logger.warn("Could not install the base Python packages", failure);
    }
  });

  // Warn before stopping in-flight agents and the jobs chats left running.
  // Fails open so a count error never blocks quitting.
  const confirmQuitWithRunningWork = async (): Promise<boolean> => {
    let count = 0;
    try {
      ({ count } = await call(
        workspaceRouter.chats.agentStatus.aliveAgentCount,
        undefined,
        { context: { workspaceConfig, workspaceRef: actor } },
      ));
    } catch (error) {
      captureServerException(
        error instanceof Error ? error : new Error(String(error)),
        { scopes: ["studio"] },
      );
      return true;
    }

    const prompt = quitPrompt({
      agentCount: count,
      jobNames: runningJobNames(),
    });
    if (!prompt) {
      return true;
    }

    const options: Electron.MessageBoxOptions = {
      ...prompt,
      buttons: ["Cancel", "Quit"],
      cancelId: 0,
      defaultId: 0,
      noLink: true,
      type: "warning",
    };

    // Parent the dialog on the window that is being closed so it is
    // window-modal, rather than a detached app-modal box that can end up behind
    // the window it is asking about.
    const parentWindow = getForegroundWindow();
    const { response } = await (parentWindow
      ? dialog.showMessageBox(parentWindow, options)
      : dialog.showMessageBox(options));

    return response === 1;
  };

  startQuit(
    quitMachine.provide({
      actions: {
        announce: (_, { stage }) => {
          logger.info(`Quit teardown: ${stage}`);
        },
        exit: () => {
          actor.stop();
          // app.exit skips everything after it, so what the windows wrote in
          // the last moments goes to disk here.
          flushKeptState();
          app.exit(quitExitCode());
        },
        reportBrowserSessionsTimeout: () => {
          captureServerException(
            new Error("agent-browser close --all timed out on quit"),
            { scopes: ["studio"] },
          );
        },
        reveal: ensureForegroundWindowVisible,
        teardownBrowserViews: () => {
          browserViewManager.teardown();
        },
      },
      actors: {
        approve: fromPromise(() => {
          // Dev hot reload quits the app (SIGTERM -> before-quit) on every
          // main-process rebuild. Skip the running-agents prompt in dev so a
          // reload is never blocked waiting on a dialog nobody sees, which would
          // strand the old instance while electron-vite launches a new one.
          // Teardown still runs. The dev panel can opt back in to exercise the
          // prompt deliberately.
          if (is.dev && !isQuitGuardForcedInDev()) {
            return Promise.resolve(true);
          }
          return confirmQuitWithRunningWork();
        }),
        closeBrowserSessions: fromPromise(() => closeAllAgentBrowserSessions()),
        stopServices: fromPromise(async () => {
          // @parcel/watcher aborts the process (SIGABRT) if a live subscription
          // is torn down while Node frees the environment, so stop the skills
          // watcher and await its unsubscribe before app.exit.
          await Promise.all([
            stopWorkspaceSkillWatcher().catch(noop),
            // Agent-started servers and watchers outlive the turn that started
            // them, so quitting is what ends them. The tasks at work are
            // stopped and their chats told first, while what each has running
            // can still be named.
            interruptTasksForQuit(actor)
              .catch((error: unknown) => {
                captureServerException(
                  error instanceof Error ? error : new Error(String(error)),
                  { scopes: ["studio"] },
                );
              })
              .then(() => killAllBackgroundProcesses())
              .catch(noop),
          ]);
          // Last, so the stops the tasks just wrote are on disk: every chat's
          // records are landed and synced before the process goes.
          await StoreRecords.settle().catch((error: unknown) => {
            captureServerException(
              error instanceof Error ? error : new Error(String(error)),
              { scopes: ["studio"] },
            );
          });
        }),
      },
      delays: {
        // Killing background processes is the slowest step, and its bound is
        // derived rather than restated here: a hand-picked number would go
        // quietly wrong the next time the termination grace moves.
        teardown:
          BROWSER_SESSIONS_CLOSE_MS +
          BACKGROUND_PROCESS_TEARDOWN_MS +
          QUIT_TEARDOWN_SLACK_MS,
      },
    }),
  );

  app.on("before-quit", (e) => {
    // Always intercept; the teardown ends in app.exit. A second quit during
    // shutdown must not bypass preventDefault and skip cleanup.
    e.preventDefault();
    requestQuit();
  });

  return {
    actor,
    workspaceConfig,
  };
}

/**
 * Bring what earlier builds kept apart into the workspace's `workspace.db`
 * before the workspace opens it. Every workspace, wherever it is kept; a
 * failure must not block boot.
 */
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
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
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
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
  }
}

/** What naming a chat's database, or splitting its records, did. */
function reportChatRecords(records: ChatRecordsSplit) {
  for (const step of records.done) {
    logger.info(`Chat records: ${step}`);
  }
  if (records.failed > 0) {
    logger.warn(
      `Left ${records.failed} chat entr${records.failed === 1 ? "y" : "ies"} to move on the next boot`,
    );
  }
}

/**
 * Bring what each chat allowed out of its own settings and into this
 * computer's permission settings. Idempotent; a failure must not block boot.
 */
async function carryChatPermissions() {
  try {
    const { moved } = await moveChatPermissions();
    if (moved > 0) {
      logger.info(
        `Chat permissions: moved ${moved} chat${moved === 1 ? "" : "s"} onto this computer's settings`,
      );
    }
  } catch (error) {
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
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
    for (const step of converted.done) {
      logger.info(`Chat records: ${step}`);
    }
    for (const { reason, where } of converted.left) {
      logger.warn(
        `Chat records: left ${where} on its database and will try again next launch: ${reason}`,
      );
    }
  } catch (error) {
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
  }
}

/**
 * Give every chat the folder a person opens, `Chats/<title>/`, with its
 * transcript written from its records. Runs after the converter, so a chat
 * whose conversation was still in a database has records to write from.
 * Idempotent: a chat whose folder and transcript are already what its
 * records say is left alone, so this costs a launch a listing of the folder.
 * A failure must not block boot.
 */
async function writeChatFolders(rootDir: string) {
  try {
    const startedAt = performance.now();
    const swept = await giveChatsTheirFolders(rootDir);
    logger.info(
      `Chat folders: wrote ${swept.counts.written} and found ${swept.counts["already-there"]} already there, in ${Math.round(performance.now() - startedAt)}ms`,
    );
    for (const chat of swept.chats) {
      if (chat.kind === "failed") {
        logger.warn(`Chat folders: ${chat.id} has none: ${chat.error}`);
      }
    }
  } catch (error) {
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
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
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
  }
}
