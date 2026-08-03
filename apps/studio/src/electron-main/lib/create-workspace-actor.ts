import { getAIProviderConfigs } from "@/electron-main/lib/get-ai-provider-configs";
import {
  isQuitGuardForcedInDev,
  requestQuitApproval,
  setQuitApproval,
} from "@/electron-main/lib/quit-guard";
import { finalizeTelemetry } from "@/electron-main/lib/register-telemetry";
import { isFeatureEnabled } from "@/electron-main/stores/features";
import { diskModelCache } from "@/electron-main/stores/model-cache";
import { ensureMainWindowVisible } from "@/electron-main/windows/main";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import { is } from "@electron-toolkit/utils";
import { aiGatewayApp } from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";
import {
  clearOrphanedProjectRefs,
  closeAllAgentBrowserSessions,
  migrateWorkspaceLayout,
  pruneExternalBrowserTmp,
  stopAllTaskFileWatchers,
  stopWorkspaceSkillWatcher,
  workspaceMachine,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, dialog, shell } from "electron";
import path from "node:path";
import { noop } from "radashi";
import { createActor } from "xstate";

import { createBrowserViewManager } from "../browser-view/manager";
import { searchWeb } from "../platform-api/web-search";
import { captureServerEvent } from "./capture-server-event";
import { captureServerException } from "./capture-server-exception";
import { logger } from "./electron-logger";
import { getWorkspaceFolder } from "./get-workspace-folder";
import { getPNPMBinPath, getUvBinPath } from "./setup-bin-directory";

const REGISTRY_DIR_NAME = "registry";
const DEFAULT_TASK_TEMPLATE_DIR_NAME = "default-task-template";
const SYSTEM_SKILLS_DIR_NAME = "system-skills";
let UNPACKAGED_REGISTRY_DIR = path.resolve(
  import.meta.dirname,
  `../../../../${REGISTRY_DIR_NAME}`,
);
const UNPACKAGED_DEFAULT_TASK_TEMPLATE_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace/templates/default",
);
const UNPACKAGED_SYSTEM_SKILLS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../packages/workspace/system-skills",
);

const ENV_REGISTRY_DIR = import.meta.env.MAIN_VITE_APP_REGISTRY_DIR_PATH;

if (ENV_REGISTRY_DIR) {
  const absolutePath = path.resolve(ENV_REGISTRY_DIR);
  logger.info("Using custom registry directory:", absolutePath);
  UNPACKAGED_REGISTRY_DIR = absolutePath;
}

export function createWorkspaceActor({
  isQuitAlreadyConfirmed,
}: {
  // True when quitAndInstall already confirmed, so before-quit skips a second
  // prompt for the quit it triggered.
  isQuitAlreadyConfirmed: () => boolean;
}) {
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

  const browserViewManager = createBrowserViewManager();

  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      appVersion: app.getVersion(),
      browser: browserViewManager.browser,
      captureEvent: captureServerEvent,
      captureException: captureServerException,
      defaultTaskTemplateDir: app.isPackaged
        ? path.join(process.resourcesPath, DEFAULT_TASK_TEMPLATE_DIR_NAME)
        : UNPACKAGED_DEFAULT_TASK_TEMPLATE_DIR,
      getAIProviderConfigs,
      isExternalBrowserEnabled: () => isFeatureEnabled("external_browser"),
      modelCache: diskModelCache,
      nodeExecEnv: {
        // Required to allow Electron to operate as a node process
        // See https://www.electronjs.org/docs/latest/api/environment-variables
        ELECTRON_RUN_AS_NODE: "1",
      },
      pnpmBinPath: getPNPMBinPath(),
      registryDir: app.isPackaged
        ? path.join(process.resourcesPath, REGISTRY_DIR_NAME)
        : UNPACKAGED_REGISTRY_DIR,
      rootDir,
      shimClientDir: app.isPackaged
        ? path.resolve(process.resourcesPath, "shim-client")
        : import.meta.env.MAIN_VITE_USE_BUILT_SHIM_CLIENT
          ? path.resolve(
              import.meta.dirname,
              "../../../../packages/shim-client/dist",
            )
          : "dev-server",
      systemSkillsDir: app.isPackaged
        ? path.join(process.resourcesPath, SYSTEM_SKILLS_DIR_NAME)
        : UNPACKAGED_SYSTEM_SKILLS_DIR,
      trashItem: (pathToTrash) => shell.trashItem(pathToTrash),
      uvBinPath: getUvBinPath(),
      uvDataDir: path.join(app.getPath("userData"), "uv"),
      webSearch: searchWeb,
    },
    inspect(event) {
      if (!is.dev) {
        return;
      }
      /* eslint-disable no-console */
      switch (event.type) {
        case "@xstate.action": {
          if (
            !event.action.type.startsWith("xstate.") &&
            event.action.type !== "actions" &&
            event.action.type !== "publishLogs"
          ) {
            console.groupCollapsed(
              `%c[XState Action] ${event.action.type}`,
              "color: #4caf50",
            );
            if (event.action.params) {
              console.log("params:", event.action.params);
            }
            console.groupEnd();
          }

          break;
        }
        case "@xstate.event": {
          if (!event.event.type.startsWith("xstate.")) {
            if (
              event.event.type === "llmRequest.chunkReceived" ||
              event.event.type.toLowerCase().includes("heartbeat") ||
              event.event.type === "spawnRuntime.log"
            ) {
              return;
            }

            const eventValue: unknown =
              "value" in event.event ? event.event.value : undefined;
            const hasDetails = eventValue !== undefined;

            if (hasDetails) {
              console.groupCollapsed(
                `%c[XState Event] ${event.event.type}`,
                "color: #9e9e9e",
              );
              console.log("value:", eventValue);
              console.groupEnd();
            } else {
              console.log(`%c[Event] ${event.event.type}`, "color: #9e9e9e");
            }
          }

          break;
        }
      }
      /* eslint-enable no-console */
    },
  });
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

  // Reconcile task -> project references against disk. A project folder can be
  // deleted outside the app (or while it is closed), leaving tasks pointing at
  // a project that no longer exists; in-app deletes already sweep, but disk
  // deletes do not. Best-effort and async; must not block boot.
  void clearOrphanedProjectRefs()
    .then((clearedTaskIds) => {
      if (clearedTaskIds.length > 0) {
        logger.info(
          `Cleared ${clearedTaskIds.length} task(s) referencing a deleted project`,
        );
      }
    })
    .catch((error: unknown) => {
      captureServerException(
        error instanceof Error ? error : new Error(String(error)),
        { scopes: ["studio"] },
      );
    });

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
    const parentWindow = getMainWindow();
    const { response } = await (parentWindow
      ? dialog.showMessageBox(parentWindow, options)
      : dialog.showMessageBox(options));

    return response === 1;
  };

  setQuitApproval(async () => {
    // Dev hot reload quits the app (SIGTERM -> before-quit) on every
    // main-process rebuild. Skip the running-agents prompt in dev so a reload is
    // never blocked waiting on a dialog nobody sees, which would strand the old
    // instance while electron-vite launches a new one. Teardown still runs.
    // The dev panel can opt back in to exercise the prompt deliberately.
    if ((is.dev && !isQuitGuardForcedInDev()) || isQuitAlreadyConfirmed()) {
      return true;
    }
    return confirmQuitWithRunningAgents();
  });

  let isQuitHandling = false;
  let isQuitInProgress = false;

  app.on("before-quit", (e) => {
    // Always intercept; we call app.exit(0) after teardown. A second quit
    // during shutdown must not bypass preventDefault and skip cleanup.
    e.preventDefault();

    if (isQuitInProgress || isQuitHandling) {
      return;
    }

    void (async () => {
      isQuitHandling = true;
      try {
        if (!(await requestQuitApproval())) {
          // Canceling has to leave the user somewhere. This quit may have
          // started from a window close, and outside macOS a process whose last
          // window is gone can't be reached again at all.
          void ensureMainWindowVisible();
          return;
        }

        isQuitInProgress = true;
        // The app.exit below skips `will-quit`, where the telemetry flush and
        // crash-marker cleanup would otherwise run, so drive them from here.
        // Started now so they overlap the rest of the teardown instead of
        // adding to it.
        const telemetryFinalized = finalizeTelemetry();

        let hasExited = false;
        const doExit = () => {
          if (hasExited) {
            return;
          }
          hasExited = true;
          browserViewManager.teardown();

          let finalized = false;
          const finalize = () => {
            if (finalized) {
              return;
            }
            finalized = true;
            actor.stop();
            app.exit(0);
          };
          // @parcel/watcher aborts the process (SIGABRT) if a live subscription
          // is torn down while Node frees the environment, so stop watchers and
          // await their unsubscribe before app.exit. Runs before actor.stop so
          // watchers still held by an in-flight turn are captured. Bounded so a
          // stuck unsubscribe can't wedge the quit.
          const forceFinalize = setTimeout(finalize, 2000);
          void Promise.all([
            stopAllTaskFileWatchers().catch(noop),
            stopWorkspaceSkillWatcher().catch(noop),
            telemetryFinalized,
          ]).finally(() => {
            clearTimeout(forceFinalize);
            finalize();
          });
        };
        const timeout = setTimeout(() => {
          captureServerException(
            new Error("agent-browser close --all timed out on quit"),
            { scopes: ["studio"] },
          );
          doExit();
        }, 3000);
        void closeAllAgentBrowserSessions().finally(() => {
          clearTimeout(timeout);
          doExit();
        });
      } finally {
        if (!isQuitInProgress) {
          isQuitHandling = false;
        }
      }
    })();
  });

  return {
    actor,
    browserViewManager,
    confirmQuitWithRunningAgents,
    workspaceConfig,
  };
}
