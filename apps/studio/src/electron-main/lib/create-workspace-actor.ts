import { recordPlatformRefusal } from "@/electron-main/lib/platform-refusals";
import { refreshExpiredTokens } from "@/electron-main/lib/chatgpt-account";
import { getAIProviderConfigs } from "@/electron-main/lib/get-ai-provider-configs";
import { getSignedInUser } from "@/electron-main/lib/get-signed-in-user";
import { macHelperBinPath } from "@/electron-main/lib/mac-native";
import {
  isQuitGuardForcedInDev,
  requestQuit,
  startQuit,
} from "@/electron-main/lib/quit";
import { finalizeTelemetry } from "@/electron-main/lib/register-telemetry";
import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import { isFeatureEnabled } from "@/electron-main/stores/workspace/features";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { is } from "@electron-toolkit/utils";
import { aiGatewayApp } from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";
import createBashWorker from "@instrument-org/workspace/bash-worker?nodeWorker";
import {
  attachChats,
  BACKGROUND_PROCESS_TEARDOWN_MS,
  closeAllAgentBrowserSessions,
  killAllBackgroundProcesses,
  migrateWorkspaceLayout,
  pruneExternalBrowserTmp,
  setBashWorkerFactory,
  stopWorkspaceSkillWatcher,
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
import { captureServerEvent } from "./capture-server-event";
import { captureServerException } from "./capture-server-exception";
import { logger } from "./electron-logger";
import { getWorkspaceFolder } from "./get-workspace-folder";
import { ensureOutputFolderIcon } from "./output-folder-icon";
import { BROWSER_SESSIONS_CLOSE_MS, quitMachine } from "./quit-machine";
import { getRegistryDir } from "./registry-dir";
import { quitExitCode } from "./relaunch";
import { getPNPMBinPath, getUvBinPath } from "./setup-bin-directory";

const DEFAULT_TASK_TEMPLATE_DIR_NAME = "default-task-template";
const SYSTEM_SKILLS_DIR_NAME = "system-skills";

/**
 * What quit teardown allows the skills watcher and the telemetry flush on top of
 * the slowest thing it waits for. Enough that a background process taking its
 * whole grace period does not spend the other two's budget as well.
 */
const QUIT_TEARDOWN_SLACK_MS = ms("2 seconds");
const UNPACKAGED_DEFAULT_TASK_TEMPLATE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace/templates/default",
);
const UNPACKAGED_SYSTEM_SKILLS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace/system-skills",
);
export function createWorkspaceActor() {
  const rootDir = getWorkspaceFolder();

  // Normalize the on-disk layout of any legacy tasks before the workspace reads
  // them. Idempotent; a failure must not block boot.
  try {
    const migrationStartedAt = performance.now();
    const migration = migrateWorkspaceLayout({ rootDir });
    logger.info(
      `Workspace layout migration: ${Math.round(performance.now() - migrationStartedAt)}ms`,
    );
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

  // Reclaims cloned Chrome profiles a crash left behind. Off the boot path:
  // nothing waits on it, and the dir it clears is only read by an external
  // browser launch, which cannot happen before the workspace is up.
  void pruneExternalBrowserTmp({ rootDir }).catch((error: unknown) => {
    captureServerException(
      error instanceof Error ? error : new Error(String(error)),
      { scopes: ["studio"] },
    );
  });

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
      captureEvent: captureServerEvent,
      captureException: captureServerException,
      defaultTaskTemplateDir: app.isPackaged
        ? path.join(process.resourcesPath, DEFAULT_TASK_TEMPLATE_DIR_NAME)
        : UNPACKAGED_DEFAULT_TASK_TEMPLATE_DIR,
      ensureOutputFolderIcon,
      macHelperBinPath: macHelperBinPath(),
      getAIProviderConfigs,
      getUser: getSignedInUser,
      // Beside the other per-machine state rather than in the workspace: the
      // index is derived, and a workspace may sit in a synced folder.
      indexesDir: path.join(app.getPath("userData"), "indexes"),
      isExternalBrowserEnabled: () => isFeatureEnabled("external_browser"),
      modelCache: diskModelCache,
      nodeExecEnv: {
        // Required to allow Electron to operate as a node process
        // See https://www.electronjs.org/docs/latest/api/environment-variables
        ELECTRON_RUN_AS_NODE: "1",
      },
      pnpmBinPath: getPNPMBinPath(),
      reportPlatformRefusal: recordPlatformRefusal,
      // Beside the app-managed `bin` and `uv`, and outside the workspace: the
      // set is prepared per machine, so several workspaces or a workspace the
      // user moves all source from one copy of it.
      preparedSkillsDir: path.join(app.getPath("userData"), "skills"),
      refreshExpiredCredentials: refreshExpiredTokens,
      registryDir: getRegistryDir(),
      rootDir,
      systemSkillsDir: app.isPackaged
        ? path.join(process.resourcesPath, SYSTEM_SKILLS_DIR_NAME)
        : UNPACKAGED_SYSTEM_SKILLS_DIR,
      trashItem: (pathToTrash) => shell.trashItem(pathToTrash),
      uvBinPath: getUvBinPath(),
      uvDataDir: path.join(app.getPath("userData"), "uv"),
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

  // Warn before stopping in-flight agents. Fails open so a count error never
  // blocks quitting.
  const confirmQuitWithRunningAgents = async (): Promise<boolean> => {
    let count = 0;
    try {
      ({ count } = await call(
        workspaceRouter.task.agentStatus.aliveAgentCount,
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

    if (count === 0) {
      return true;
    }

    const options: Electron.MessageBoxOptions = {
      buttons: ["Cancel", "Quit"],
      cancelId: 0,
      defaultId: 0,
      detail:
        "Active tasks will be interrupted and you may lose in-progress work.",
      message: `Quit ${APP_NAME}?`,
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
          return confirmQuitWithRunningAgents();
        }),
        closeBrowserSessions: fromPromise(() => closeAllAgentBrowserSessions()),
        // The app.exit at the end skips `will-quit`, where the telemetry flush
        // and crash-marker cleanup would otherwise run, so drive them from here.
        finalizeTelemetry: fromPromise(() => finalizeTelemetry()),
        stopServices: fromPromise(async () => {
          // @parcel/watcher aborts the process (SIGABRT) if a live subscription
          // is torn down while Node frees the environment, so stop the skills
          // watcher and await its unsubscribe before app.exit.
          await Promise.all([
            stopWorkspaceSkillWatcher().catch(noop),
            // Agent-started servers and watchers outlive the turn that started
            // them, so quitting is what ends them.
            killAllBackgroundProcesses().catch(noop),
          ]);
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
    browserViewManager,
    workspaceConfig,
  };
}
