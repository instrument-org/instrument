import {
  isHostedFeatureAvailable,
  isPlatformSearchForEveryModel,
} from "@/electron-main/lib/hosted-features";
import { lookUpSentLinkTitles } from "@/electron-main/browser-view/sent-link-titles";
import { recordPlatformRefusal } from "@/electron-main/lib/platform-refusals";
import { getMachinePreferences } from "@/electron-main/stores/machine/preferences";
import { refreshExpiredTokens } from "@/electron-main/lib/chatgpt-account";
import { refreshExpiredGrokTokens } from "@/electron-main/lib/grok-account";
import { getAIProviderConfigs } from "@/electron-main/lib/get-ai-provider-configs";
import { getSignedInUser } from "@/electron-main/lib/get-signed-in-user";
import {
  finderEntries,
  macAppAccess,
  macAppsServerPath,
  macHelperBinPath,
  macosPromptOnScreen,
  seatbeltHelperPath,
  resolveAlias,
} from "@/electron-main/lib/mac-native";
import {
  isQuitGuardForcedInDev,
  requestQuit,
  startQuit,
} from "@/electron-main/lib/quit";
import { diskModelCache } from "@/electron-main/stores/machine/model-cache";
import { workspaceModelRoutes } from "@/electron-main/stores/workspace/state";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { is } from "@electron-toolkit/utils";
import { aiGatewayApp } from "@instrument-org/ai-gateway";
import createBashWorker from "@instrument-org/workspace/bash-worker?nodeWorker";
import {
  attachChats,
  BACKGROUND_PROCESS_TEARDOWN_MS,
  closeAllAgentBrowserSessions,
  type DeviceId,
  ensurePythonBase,
  interruptTasksForQuit,
  killAllBackgroundProcesses,
  prepareBundledSkills,
  setBashWorkerFactory,
  startRecordArrivals,
  stopRecordArrivals,
  chatRecords,
  warmBashWorker,
  workspaceMachine,
  workspaceRouter,
} from "@instrument-org/workspace/electron";
import { call } from "@orpc/server";
import { app, BrowserWindow, dialog, shell } from "electron";
import ms from "ms";
import path from "node:path";
import { noop } from "radashi";
import { createActor, fromPromise } from "xstate";

import { getBrowserViewManager } from "../browser-view/manager";
import { flushKeptState } from "../stores/workspace/kept-state";
import { searchWeb } from "../platform-api/web-search";
import { createAppsConfig, rememberAppsDir } from "./apps";
import { captureFor, captureServerException } from "./capture-server-exception";
import { isDictationInProgress } from "./dictation-in-progress";
import { logger } from "./electron-logger";
import {
  getUserDataDir,
  getWorkspaceFolder,
  workspaceInAppData,
  workspaceMachineDir,
  workspaceWorkFoldersDir,
} from "./get-workspace-folder";
import { unchosenOutputFolder, workspaceDbFileOf } from "./workspaces";
import { sweepWorkspaceFolder } from "./workspace-launch-sweeps";
import { ensureOutputFolderIcon } from "./output-folder-icon";
import { isRefusedFile } from "./refused-files";
import { BROWSER_SESSIONS_CLOSE_MS, quitMachine } from "./quit-machine";
import { quitPrompt, runningJobNames } from "./quit-prompt";
import { getRegistryDir } from "./registry-dir";
import { quitExitCode } from "./relaunch";
import { getRuntimeDir, removeFormerRuntime } from "./runtime-dir";
import { windowsDriveNames } from "./windows-drives";
import {
  getMxcExecPath,
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

  // The layout sweeps run only on a workspace in the app's own data
  // (`sweepWorkspaceFolder`), which is also the only one that ever held 1.x
  // tasks.
  const inAppData = workspaceInAppData();
  await sweepWorkspaceFolder({ deviceId, inAppData, rootDir });

  // The build emits the worker as its own chunk. Every agent shell runs there,
  // off the thread that paints the window, unless INSTRUMENT_BASH_WORKER=0.
  setBashWorkerFactory(createBashWorker);
  warmBashWorker();

  const browserViewManager = getBrowserViewManager();

  const actor = createActor(workspaceMachine, {
    input: {
      aiGatewayApp,
      apps: createAppsConfig(),
      appVersion: app.getVersion(),
      browser: browserViewManager.browser,
      captureException: captureFor("workspace"),
      deviceId,
      ...(process.platform === "win32"
        ? { driveNames: windowsDriveNames }
        : {}),
      ensureOutputFolderIcon,
      finderEntries,
      resolveAlias,
      // Files refuses what the viewers' file channel refuses, by one rule.
      isRefusedFile: (hostPath) => isRefusedFile(hostPath),
      ...(process.platform === "darwin"
        ? {
            macAppAccess,
            // The Mac apps' MCP server, run as Node by this executable, so
            // macOS holds the app responsible for it and what it starts.
            macAppsServer: {
              args: [macAppsServerPath()],
              command: process.execPath,
            },
            macosPromptOnScreen,
          }
        : {}),
      macHelperBinPath: macHelperBinPath(),
      seatbeltHelperPath: seatbeltHelperPath(),
      mxcExecPath: getMxcExecPath(),
      programsWithoutSandbox: getMachinePreferences().get(
        "runProgramsWithoutSandbox",
      ),
      getAIProviderConfigs,
      getUser: getSignedInUser,
      lookUpSentLinkTitles,
      // This computer's folder, and in it the workspace's: where the
      // folder rules, the browser profile and the apps' servers are, which
      // the agent never reaches.
      userDataDir: getUserDataDir(),
      // In the workspace's machine folder rather than in the workspace: a
      // workspace may sit in a synced folder.
      workspaceDbFile: workspaceDbFileOf(workspaceMachineDir()),
      workspaceMachineDir: workspaceMachineDir(),
      workFoldersDir: workspaceWorkFoldersDir(),
      knownFolders: {
        desktop: app.getPath("desktop"),
        documents: app.getPath("documents"),
        downloads: app.getPath("downloads"),
        music: app.getPath("music"),
        pictures: app.getPath("pictures"),
        videos: app.getPath("videos"),
      },
      modelCache: diskModelCache,
      modelRoutes: workspaceModelRoutes,
      nodeExecEnv: {
        // Required to allow Electron to operate as a node process
        // See https://www.electronjs.org/docs/latest/api/environment-variables
        ELECTRON_RUN_AS_NODE: "1",
      },
      // A folder the person picked is where their finished work goes too,
      // and only the app's own data ever held 1.x tasks.
      // `INSTRUMENT_OUTPUT_FOLDER` is a driven fixture's own folder, set by
      // studio-drive, so its agents never write into the developer's real
      // Instrument folder.
      ...(inAppData
        ? {
            legacyTasks: true,
            outputDir: process.env.INSTRUMENT_OUTPUT_FOLDER
              ? path.resolve(process.env.INSTRUMENT_OUTPUT_FOLDER)
              : unchosenOutputFolder(getUserDataDir()),
          }
        : { outputDir: rootDir }),
      // Passwords and sign-ins stay out of every native command's reach.
      nativeSandbox: true,
      isHostedFeatureAvailable,
      isPlatformSearchForEveryModel,
      mayOfferFeedback: () => getMachinePreferences().get("offerFeedback"),
      pnpmBinPath: getPNPMBinPath(),
      reportPlatformRefusal: recordPlatformRefusal,
      refreshExpiredCredentials: async (providerConfigId) => {
        await Promise.all([
          refreshExpiredTokens(providerConfigId),
          refreshExpiredGrokTokens(providerConfigId),
        ]);
      },
      registryDir: getRegistryDir(),
      rootDir,
      runtimeDir: getRuntimeDir(),
      systemSkillsDir: app.isPackaged
        ? path.join(process.resourcesPath, SYSTEM_SKILLS_DIR_NAME)
        : UNPACKAGED_SYSTEM_SKILLS_DIR,
      trashItem: (pathToTrash) => shell.trashItem(pathToTrash),
      uvBinPath: getUvBinPath(),
      uutilsDir: getUutilsDir(),
      uutilsOutsideSandbox: true,
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
    captureServerException(error);
    throw error;
  }

  const workspaceConfig = snapshot.context.config;
  rememberAppsDir(workspaceConfig.appsDir);
  // What another device writes into the chats folder reaches the app while
  // it runs: the folder is watched, and looked at whenever the window comes
  // forward and every minute while it is in front.
  void startRecordArrivals({
    chatsDir: workspaceConfig.chatsDir,
    device: deviceId,
    onError: (error: unknown) => {
      logger.warn("Could not look at another device's chat records", error);
    },
  }).then((arrivals) => {
    arrivals.setForeground(BrowserWindow.getFocusedWindow() !== null);
    app.on("browser-window-focus", () => {
      arrivals.setForeground(true);
    });
    app.on("browser-window-blur", () => {
      // After the focus moving to another of the app's windows lands.
      setTimeout(() => {
        if (BrowserWindow.getFocusedWindow() === null) {
          arrivals.setForeground(false);
        }
      });
    });
  });
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

  // Quitting mid-dictation throws away what was said, which the person likely
  // forgot was still recording, so it asks before anything else.
  const confirmQuitWhileDictating = async (): Promise<boolean> => {
    if (!isDictationInProgress()) {
      return true;
    }
    const options: Electron.MessageBoxOptions = {
      buttons: ["Cancel", "Quit"],
      cancelId: 0,
      defaultId: 0,
      detail: "Your dictation will be lost.",
      message: "Quit while dictating?",
      noLink: true,
      type: "warning",
    };
    const parentWindow = getForegroundWindow();
    const { response } = await (parentWindow
      ? dialog.showMessageBox(parentWindow, options)
      : dialog.showMessageBox(options));
    return response === 1;
  };

  const countRunningAgents = async () => {
    const { count } = await call(
      workspaceRouter.chats.agentStatus.aliveAgentCount,
      undefined,
      { context: { workspaceConfig, workspaceRef: actor } },
    );
    return count;
  };

  // Warn before stopping in-flight agents and the jobs chats left running.
  // Fails open so a count error never blocks quitting.
  const confirmQuitWithRunningWork = async (): Promise<boolean> => {
    let count = 0;
    try {
      count = await countRunningAgents();
    } catch (error) {
      captureServerException(error);
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
          return confirmQuitWhileDictating().then(
            (quit) => quit && confirmQuitWithRunningWork(),
          );
        }),
        closeBrowserSessions: fromPromise(() => closeAllAgentBrowserSessions()),
        stopServices: fromPromise(async () => {
          // Agent-started servers and watchers outlive the turn that started
          // them, so quitting is what ends them. The tasks at work are
          // stopped and their chats told first, while what each has running
          // can still be named.
          await interruptTasksForQuit(actor)
            .catch((error: unknown) => {
              captureServerException(error);
            })
            .then(() => killAllBackgroundProcesses())
            .catch(noop);
          stopRecordArrivals();
          // Last, so the stops the tasks just wrote are on disk: every chat's
          // records are landed and synced before the process goes.
          await chatRecords()
            .dispose()
            .catch((error: unknown) => {
              captureServerException(error);
            });
        }),
      },
      delays: {
        // Killing background processes is the slowest step, and its bound is
        // derived rather than restated here: a hand-picked number would go
        // quietly wrong the next time the termination grace moves.
        // A logout or shutdown waits on it too, and systemd gives a stopping
        // session 90 s by default before it kills what is left.
        teardown:
          BROWSER_SESSIONS_CLOSE_MS +
          BACKGROUND_PROCESS_TEARDOWN_MS +
          QUIT_TEARDOWN_SLACK_MS,
      },
    }),
    {
      // Throws when the agents cannot be counted, which a quit nobody asked
      // for reads as busy.
      runningWork: async () => ({
        agents: await countRunningAgents(),
        dictating: isDictationInProgress(),
        jobs: runningJobNames().length,
      }),
    },
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
