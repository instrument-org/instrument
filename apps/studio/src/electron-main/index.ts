/// <reference types="electron-vite/node" />

import "@/electron-main/setup-environment"; // This must be imported first
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import { runMigrations } from "@/electron-main/lib/run-migrations";
import { StudioAppUpdater } from "@/electron-main/lib/update";
import { createApplicationMenu } from "@/electron-main/menus";
import { getAppStateStore } from "@/electron-main/stores/app-state";
import {
  createMainWindow,
  updateMainWindowBackgroundColor,
} from "@/electron-main/windows/main";
import { focusMainContents } from "@/electron-main/windows/main/controls";
import { getMainWindow } from "@/electron-main/windows/main/instance";
import {
  getOnboardingWindow,
  openOnboardingWindow,
  updateOnboardingWindowBackgroundColor,
} from "@/electron-main/windows/onboarding";
import { is, optimizer } from "@electron-toolkit/utils";
import { APP_NAME, APP_PROTOCOL } from "@instrument-org/shared";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  protocol,
  session,
} from "electron";

import { startAgentCompletionNotifications } from "./lib/agent-completion-notifications";
import { registerAppProtocol } from "./lib/app-protocol";
import { warnIfRunningX64BuildUnderARM64Translation } from "./lib/arm64-translation-warning";
import { createWorkspaceActor } from "./lib/create-workspace-actor";
import { warmCommonFileOpenTargets } from "./lib/file-open-target";
import { registerTelemetry } from "./lib/register-telemetry";
import { setupBinDirectory } from "./lib/setup-bin-directory";
import {
  serveResolvedTheme,
  watchThemePreferenceAndApply,
} from "./lib/theme-utils";
import { applyStandardUserAgent } from "./lib/user-agent";
import { initializeRPC } from "./rpc/initialize";
let appUpdater: StudioAppUpdater | undefined;

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: APP_PROTOCOL,
  },
]);

app.setAsDefaultProtocolClient(APP_PROTOCOL);

registerTelemetry(app);

// Dev skips the single-instance lock so multiple worktrees can boot side by
// side. Packaged builds keep it so second launches (deep links) forward to
// the running instance.
const gotTheLock = is.dev || app.requestSingleInstanceLock();

if (gotTheLock) {
  app.on("second-instance", (_event, commandLine) => {
    focusForegroundWindow();

    const url = commandLine.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
    if (url) {
      handleDeepLink(url);
    }
  });
} else {
  app.quit();
}

// eslint-disable-next-line unicorn/prefer-top-level-await
void app.whenReady().then(async () => {
  const canContinueLaunch = await warnIfRunningX64BuildUnderARM64Translation();
  if (!canContinueLaunch) {
    app.quit();
    return;
  }

  registerAppProtocol();

  if (
    process.platform === "darwin" &&
    !is.dev &&
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

  // Present a standard Chrome User-Agent + consistent client hints for the
  // app's own remote requests (user avatars, embedded remote images), for
  // compatibility with services that respond differently to the Electron UA.
  applyStandardUserAgent(session.defaultSession);

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      // Disable fullscreen API for things like video players
      if (permission === "fullscreen") {
        callback(false);
      } else {
        callback(true);
      }
    },
  );

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

  await setupBinDirectory();

  runMigrations();

  const {
    actor: workspaceRef,
    browserViewManager,
    confirmQuitWithRunningAgents,
    workspaceConfig,
  } = createWorkspaceActor({
    isQuitAlreadyConfirmed: () => appUpdater?.status?.type === "installing",
  });

  startAgentCompletionNotifications({ workspaceConfig, workspaceRef });

  appUpdater = new StudioAppUpdater({
    confirmQuit: confirmQuitWithRunningAgents,
  });
  appUpdater.pollForUpdates();

  initializeRPC({
    appUpdater,
    browserViewManager,
    workspaceConfig,
    workspaceRef,
  });

  if (shouldShowOnboarding()) {
    openOnboardingWindow();
    void createMainWindow({ reveal: false });
  } else {
    await createMainWindow();
  }

  // Let the initial window render before running the best-effort cache warmup.
  setTimeout(() => {
    void warmCommonFileOpenTargets();
  }, 1500);

  void startAuthCallbackServer();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      if (shouldShowOnboarding()) {
        openOnboardingWindow();
      } else {
        void createMainWindow();
      }
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
});

/**
 * Bring the active foreground window forward. The main window is the target
 * once visible; while it is still hidden (e.g. prepared during onboarding),
 * onboarding stays the foreground target so focus never lands on nothing.
 */
function focusForegroundWindow() {
  const mainWindow = getMainWindow();
  if (mainWindow?.isVisible()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    focusMainContents();
    return;
  }
  getOnboardingWindow()?.focus();
}

function handleDeepLink(_url: string) {
  focusForegroundWindow();
}

function shouldShowOnboarding(): boolean {
  if (process.env.SKIP_ONBOARDING === "true") {
    return false;
  }
  const appStateStore = getAppStateStore();
  return !appStateStore.get("hasCompletedProviderSetup");
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function applyThemeToWindows() {
  updateMainWindowBackgroundColor();
  updateOnboardingWindowBackgroundColor();
}
