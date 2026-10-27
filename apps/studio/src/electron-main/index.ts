/// <reference types="electron-vite/node" />

import "@/electron-main/thread-pool"; // Before anything starts the pool
import "@/electron-main/setup-environment"; // This must be imported next
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  refreshAfterWake as refreshChatGPTAccountAfterWake,
  scheduleRefresh as scheduleChatGPTAccountRefresh,
} from "@/electron-main/lib/chatgpt-account";
import {
  refreshGrokAfterWake,
  scheduleGrokRefresh,
} from "@/electron-main/lib/grok-account";
import {
  keepClaudeCodeCurrent,
  refreshClaudeAccountStatus,
} from "@/electron-main/lib/claude-account";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { drawCornerDot } from "@/electron-main/lib/dev-dock-icon";
import { logger } from "@/electron-main/lib/electron-logger";
import { setClaudeAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { openOutsideLink } from "@/electron-main/lib/outside-links";
import { setupStateKnown } from "@/electron-main/lib/setup-state";
import { createStudioAppUpdater } from "@/electron-main/lib/update";
import { createApplicationMenu } from "@/electron-main/menus";
import { finishPlacingLeftovers } from "@/electron-main/rpc/routes/files";
import { checkRecentVersionBump } from "@/electron-main/stores/machine/state";
import { getDefaultModelURI } from "@/electron-main/stores/workspace/preferences";
import {
  askAppWindow,
  openAppFile,
  openAppWindow,
  updateAppWindowBackgroundColor,
  waitingAppWindowAsks,
} from "@/electron-main/windows/app-window";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import { showHeldWindows } from "@/electron-main/windows/on-screen";
import {
  DEV_INSTANCE_COLORS,
  isDevInstanceColor,
} from "@/shared/dev-instance-colors";
import { is, optimizer } from "@electron-toolkit/utils";
import { APP_NAME, APP_FLAVOR, APP_PROTOCOL } from "@instrument-org/shared";
import {
  BrowserWindow,
  app,
  dialog,
  nativeImage,
  nativeTheme,
  powerMonitor,
  protocol,
  session,
} from "electron";
import module from "node:module";

import { serveDrafts } from "./drafts/serve-drafts";
import { serveKeptState } from "./stores/workspace/kept-state";
import { serveSetupState } from "./lib/serve-setup-state";
import { serveBookmarks } from "./bookmarks/serve-bookmarks";
import { serveRendererExceptions } from "./lib/renderer-exceptions";
import {
  configureAppSession,
  waitForPreviousDevInstance,
} from "./lib/app-session";
import { warnIfRunningX64BuildUnderARM64Translation } from "./lib/arm64-translation-warning";
import { timeBootStep } from "./lib/boot-timing";
import { registerFileDragHandler } from "./lib/file-drag";
import { warmCommonFileOpenTargets } from "./lib/file-open-target";
import { filesInArgv } from "./lib/files-in-argv";
import { logGpuStatus } from "./lib/gpu-status";
import { handleBootFailure } from "./lib/handle-boot-failure";
import { startAppCatalog } from "./lib/app-catalog";
import { startNotices } from "./lib/notices";
import { sendPendingAutomatically } from "./lib/problem-reports";
import { registerCrashDiagnostics } from "./lib/register-crash-diagnostics";
import {
  quitsWithLastWindow,
  requestQuitApproval,
  withdrawQuitApproval,
} from "./lib/quit";
import { registerUnattendedQuit } from "./lib/unattended-quit";
import { getWorkspaceRefusal } from "./lib/workspace-refusal";
import { getWorkspaceRun } from "./lib/workspace-run";
import { startWorkspace } from "./lib/start-workspace";
import { showWorkspaceRefusal } from "./lib/workspace-refusal-window";
import { setupBinDirectory } from "./lib/setup-bin-directory";
import {
  serveResolvedTheme,
  watchThemePreferenceAndApply,
} from "./lib/theme-utils";
import { servePageEditorBoot } from "./page-editor/sessions";
import { startNetworkStatus } from "./lib/network-status";
import { platformApiQueryClient } from "./platform-api/client";
import { initializeRPC } from "./rpc/initialize";
import { watchMainThreadStalls } from "./lib/main-thread-stalls";
import { watchProcessCpu } from "./lib/process-cpu";

// Dev skips the single-instance lock so multiple worktrees can boot side by
// side. Packaged builds keep it so second launches (deep links) forward to
// the running instance.
const gotTheLock = is.dev || app.requestSingleInstanceLock();

if (gotTheLock) {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        // The built renderer is served from this scheme (`app-protocol.ts`),
        // and Chromium keeps V8's compiled code for a custom scheme's scripts
        // only when it opts in. Development loads from the dev server.
        codeCache: true,
        // The renderer's origin is one host of this scheme, so the document
        // viewers fetching their WASM from another is a cross-origin request.
        // Chromium rejects those for custom schemes unless the scheme itself
        // opts in, regardless of the response's CORS headers.
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
      scheme: APP_PROTOCOL,
    },
  ]);

  app.setAsDefaultProtocolClient(APP_PROTOCOL);

  registerCrashDiagnostics(app);

  app.on("second-instance", (_event, commandLine) => {
    // A refused workspace's window is the only one, and takes nothing else.
    if (getWorkspaceRefusal()) {
      BrowserWindow.getAllWindows()[0]?.focus();
      return;
    }
    focusForegroundWindow();

    const url = linkInArgv(commandLine);
    if (url) {
      handleDeepLink(url);
    }
    for (const filePath of filesInArgv(commandLine, {
      defaultApp: process.defaultApp,
    })) {
      openAppFile(filePath);
    }
  });

  // A file handed over from the Finder: a double click where Instrument is
  // the default, or Open With. Listened for before ready, because a file that
  // launches the app arrives before it is; the screen waits for the window.
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (!getWorkspaceRefusal()) {
      openAppFile(filePath);
    }
  });

  // A link handed over from outside, listened for before ready for the same
  // reason: the link that launches the app arrives before it is.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!getWorkspaceRefusal()) {
      handleDeepLink(url);
    }
  });

  // The same hand-overs on Windows and Linux, for a launch that starts the app.
  if (!getWorkspaceRefusal()) {
    for (const filePath of filesInArgv(process.argv, {
      defaultApp: process.defaultApp,
    })) {
      openAppFile(filePath);
    }
    const url = linkInArgv(process.argv);
    if (url) {
      handleDeepLink(url);
    }
  }

  void app.whenReady().then(bootstrapPrimaryInstance).catch(handleBootFailure);
} else {
  // A lock loser has no application state to tear down. Exit synchronously so
  // quit handlers cannot keep it alive long enough to enter primary startup.
  app.exit(0);
}

async function bootstrapPrimaryInstance() {
  registerUnattendedQuit();

  // A workspace this build will not open is said in a window of its own, and
  // nothing else starts: no stores, no workspace, no other window.
  const refusal = getWorkspaceRefusal();
  if (refusal) {
    await showWorkspaceRefusal({ refusal });
    return;
  }

  const canContinueLaunch = await warnIfRunningX64BuildUnderARM64Translation();
  if (!canContinueLaunch) {
    app.quit();
    return;
  }

  // A development run is Electron's own binary, so the Dock would show
  // Electron's icon. It shows the app's in the development color instead, which
  // keeps it apart from an installed Instrument running beside it. An instance
  // studio-drive booted adds the dot of the color it was handed.
  if (import.meta.env.DEV && process.platform === "darwin") {
    void import("../../build/flavors/development/icon.png?asset").then(
      ({ default: icon }) => {
        const color = process.env.STUDIO_DRIVE_COLOR;
        if (!isDevInstanceColor(color)) {
          app.dock?.setIcon(icon);
          return;
        }
        const image = nativeImage.createFromPath(icon);
        const { width, height } = image.getSize();
        const bitmap = image.toBitmap();
        drawCornerDot(bitmap, width, DEV_INSTANCE_COLORS[color]);
        app.dock?.setIcon(
          nativeImage.createFromBitmap(bitmap, { height, width }),
        );
      },
    );
  }

  // A preview is meant to be tried where it was unzipped and thrown away.
  if (
    process.platform === "darwin" &&
    !is.dev &&
    APP_FLAVOR.kind !== "preview" &&
    !app.isInApplicationsFolder() &&
    process.env.SKIP_MOVE_TO_APPLICATIONS !== "true"
  ) {
    const choice = dialog.showMessageBoxSync({
      buttons: ["Move to Applications Folder", "Not Now"],
      cancelId: 1,
      defaultId: 0,
      message: `${APP_NAME} works best when run from the Applications folder. Would you like to move it now?`,
      title: "Move to Applications Folder?",
      type: "question",
    });

    if (choice === 0) {
      const moved = app.moveToApplicationsFolder({
        conflictHandler: () => {
          return (
            dialog.showMessageBoxSync({
              buttons: ["Replace", "Cancel"],
              cancelId: 1,
              defaultId: 0,
              message:
                "An app with the same name already exists in the Applications folder. Do you want to replace it?",
              title: "Replace Existing App?",
              type: "question",
            }) === 0
          );
        },
      });

      if (moved) {
        app.quit();
        return;
      }
    }
  }

  await timeBootStep("waitForPreviousDevInstance", waitForPreviousDevInstance);

  // The app's windows run on the workspace's own session (getAppSession); the
  // default one still makes the main process's own requests.
  configureAppSession(session.defaultSession);

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window, { zoom: true });
  });

  createApplicationMenu();
  watchThemePreferenceAndApply(applyThemeToWindows);
  nativeTheme.on("updated", applyThemeToWindows);
  // Registered before any window exists, so no preload can ask before it answers.
  serveResolvedTheme();
  serveSetupState();
  serveKeptState();
  serveDrafts();
  serveBookmarks();
  serveRendererExceptions();
  servePageEditorBoot();

  // Early, so the first requests to a local API server that is not running
  // already find it known as down. Back online, the queries that failed run
  // again.
  startNetworkStatus({
    onBackOnline: () =>
      void platformApiQueryClient.refetchQueries({ type: "active" }),
  });

  await timeBootStep("setupBinDirectory", setupBinDirectory);

  // Detect whether the app was updated since the last launch so the bell can
  // say so.
  await timeBootStep("checkRecentVersionBump", checkRecentVersionBump);
  // What a quit or crash left mid-placing in the Finder, finished before
  // anything is placed again.
  void finishPlacingLeftovers().catch(captureServerException);

  // A workspace with a folder starts before any window, whose preload reads
  // its drafts and bookmarks as it loads. A first launch's starts once
  // setup's first step places it (`workspaces.place`).
  if (getWorkspaceRun().kind === "placed") {
    await startWorkspace();
  }

  // A signed-in ChatGPT account's access token lasts an hour.
  scheduleChatGPTAccountRefresh();
  powerMonitor.on("resume", refreshChatGPTAccountAfterWake);
  scheduleGrokRefresh();
  powerMonitor.on("resume", refreshGrokAfterWake);

  // The Claude account is whatever the CLI says: someone installs it or signs
  // in from a terminal, then comes back to the app.
  // A workspace with no model chosen yet runs on the subscription it found.
  void refreshClaudeAccountStatus().then(async (found) => {
    if (found.kind === "signed-in" && !getDefaultModelURI()) {
      await setClaudeAccountDefaultModel();
    }
  });
  void keepClaudeCodeCurrent();
  app.on("browser-window-focus", () => {
    void refreshClaudeAccountStatus();
  });

  const updater = createStudioAppUpdater({
    // Approving the install approves the quit it ends in, so before-quit and
    // the window close go ahead without asking again. An install that then
    // fails takes the approval back.
    confirmQuit: requestQuitApproval,
    withdrawQuit: withdrawQuitApproval,
  });
  if (process.env.DISABLE_AUTO_UPDATE_POLLING !== "true") {
    updater.pollForUpdates();
    powerMonitor.on("resume", updater.checkAfterWake);
  }

  registerFileDragHandler();

  watchMainThreadStalls();
  watchProcessCpu();

  await timeBootStep("initializeRPC", () => {
    initializeRPC({ appUpdater: updater });
  });

  // The window opens at setup's size or its own, so it waits for setup's
  // slow facts (a few seconds at most, and never once setup is finished).
  await setupStateKnown();
  openAppWindow();

  // Let the initial window render before running the best-effort cache warmup.
  setTimeout(() => {
    void warmCommonFileOpenTargets();
  }, 1500);

  // What the compile cache (`boot.ts`) gathered while booting reaches disk
  // here rather than at exit, so it does not depend on how the process ends.
  // Not sooner: the first write after an update takes a couple hundred
  // milliseconds of this thread, which the window's own files are served from.
  setTimeout(() => {
    void timeBootStep("flushCompileCache", () => module.flushCompileCache());
  }, 5000);

  // Nothing waits on this. It resolves once the GPU process has finished
  // reporting, which is the only point at which the answer is worth writing
  // down, and it is written for a support conversation rather than for the app.
  void logGpuStatus(app);

  void startAuthCallbackServer();

  // A crash from the last session goes out now when the person chose to send
  // error reports without asking; otherwise it waits in the bell.
  void sendPendingAutomatically();

  // Notices from us for this build and account, for the bell.
  startNotices();

  // The app directory as we serve it now, in place of the one built in.
  startAppCatalog();

  app.on("activate", function () {
    // An agent's instance waiting off screen comes up when its Dock icon is
    // clicked.
    if (showHeldWindows()) {
      return;
    }
    // The Dock icon brings a window back once every window is closed. A
    // hidden window drawing a file's picture is not one to come back to.
    if (!getForegroundWindow()) {
      openAppWindow();
    }
  });
}

/**
 * Bring the active foreground window forward.
 *
 * With no window to come forward this opens one. Relaunching the app is how a
 * user asks for a window back, and the single-instance lock routes that launch
 * here instead of starting a process that could serve it.
 */
function focusForegroundWindow() {
  const target = getForegroundWindow();
  if (target?.isVisible()) {
    if (target.isMinimized()) {
      target.restore();
    }
    target.focus();
    return;
  }

  // A second launch can land here while the first instance is still booting,
  // before windows may be created; that boot opens its own window anyway.
  if (!app.isReady()) {
    return;
  }
  ensureForegroundWindowVisible();
}

/**
 * A link from outside the app: the website's "Try in Instrument", a reply's
 * address pasted somewhere else, a note linking a file. The window comes
 * forward only for one that opens something (`outside-links.ts`).
 */
function handleDeepLink(url: string) {
  void openOutsideLink(url, {
    ask: (ask) => {
      focusForegroundWindow();
      askAppWindow(ask);
    },
    log: (line) => {
      // Scoped here, not at the top: a launch's own link comes through
      // before the module has finished evaluating.
      logger.scope("outside-link").info(line);
    },
    waiting: () => waitingAppWindowAsks().length,
  });
}

/** The link a launch was handed, by the scheme this build answers to. */
function linkInArgv(argv: readonly string[]) {
  return argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
}

// Closing the last window quits outside macOS, where the window's own close
// handler has already asked about running work. On macOS the app stays in the
// Dock with its work going, and Cmd+Q asks.
app.on("window-all-closed", () => {
  if (quitsWithLastWindow) {
    app.quit();
  }
});

function applyThemeToWindows() {
  updateAppWindowBackgroundColor();
}
