/// <reference types="electron-vite/node" />

import "@/electron-main/setup-environment"; // This must be imported first
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  refreshAfterWake as refreshChatGPTPlanAfterWake,
  scheduleRefresh as scheduleChatGPTPlanRefresh,
} from "@/electron-main/lib/chatgpt-plan";
import {
  keepClaudeCodeCurrent,
  refreshClaudeAccountStatus,
} from "@/electron-main/lib/claude-account";
import { setClaudeAccountDefaultModel } from "@/electron-main/lib/set-default-model";
import { createStudioAppUpdater } from "@/electron-main/lib/update";
import { createApplicationMenu } from "@/electron-main/menus";
import { checkRecentVersionBump } from "@/electron-main/stores/machine/state";
import { getDefaultModelURI } from "@/electron-main/stores/workspace/preferences";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import {
  getAppWindow,
  openAppFile,
  openAppScreen,
  openAppWindow,
  updateAppWindowBackgroundColor,
  warmAppWindowBehind,
} from "@/electron-main/windows/app-window";
import { ensureForegroundWindowVisible } from "@/electron-main/windows/ensure-foreground-visible";
import { getForegroundWindow } from "@/electron-main/windows/foreground";
import {
  openOnboardingWindow,
  updateOnboardingWindowBackgroundColor,
} from "@/electron-main/windows/onboarding";
import { revealTask } from "@/electron-main/windows/reveal-task";
import { instrumentLinkOf } from "@/shared/instrument-link";
import { is, optimizer } from "@electron-toolkit/utils";
import {
  APP_NAME,
  APP_PREVIEW_NAME,
  APP_PROTOCOL,
} from "@instrument-org/shared";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  powerMonitor,
  protocol,
  session,
} from "electron";

import { startAgentCompletionNotifications } from "./lib/agent-completion-notifications";
import { serveKeptState } from "./stores/workspace/kept-state";
import {
  configureAppSession,
  waitForPreviousDevInstance,
} from "./lib/app-session";
import { warnIfRunningX64BuildUnderARM64Translation } from "./lib/arm64-translation-warning";
import { timeBootStep } from "./lib/boot-timing";
import { createWorkspaceActor } from "./lib/create-workspace-actor";
import { registerFileDragHandler } from "./lib/file-drag";
import { warmCommonFileOpenTargets } from "./lib/file-open-target";
import { filesInArgv } from "./lib/files-in-argv";
import { logGpuStatus } from "./lib/gpu-status";
import { handleBootFailure } from "./lib/handle-boot-failure";
import { registerCrashDiagnostics } from "./lib/register-crash-diagnostics";
import { requestQuitApproval, withdrawQuitApproval } from "./lib/quit";
import { registerTelemetry } from "./lib/register-telemetry";
import { setupBinDirectory } from "./lib/setup-bin-directory";
import {
  serveResolvedTheme,
  watchThemePreferenceAndApply,
} from "./lib/theme-utils";
import { servePageEditorBoot } from "./page-editor/sessions";
import { initializeRPC } from "./rpc/initialize";

// Dev skips the single-instance lock so multiple worktrees can boot side by
// side. Packaged builds keep it so second launches (deep links) forward to
// the running instance.
const gotTheLock = is.dev || app.requestSingleInstanceLock();

if (gotTheLock) {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: {
        // The renderer's origin is never this scheme, so the document viewers
        // fetching their WASM from it is always a cross-origin request.
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
  registerTelemetry(app);

  app.on("second-instance", (_event, commandLine) => {
    focusForegroundWindow();

    const url = commandLine.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
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
    openAppFile(filePath);
  });

  // The same hand-over on Windows and Linux, for a launch that starts the app.
  for (const filePath of filesInArgv(process.argv, {
    defaultApp: process.defaultApp,
  })) {
    openAppFile(filePath);
  }

  void app.whenReady().then(bootstrapPrimaryInstance).catch(handleBootFailure);
} else {
  // A lock loser has no application state to tear down. Exit synchronously so
  // quit handlers cannot keep it alive long enough to enter primary startup.
  app.exit(0);
}

async function bootstrapPrimaryInstance() {
  const canContinueLaunch = await warnIfRunningX64BuildUnderARM64Translation();
  if (!canContinueLaunch) {
    app.quit();
    return;
  }

  // A preview is meant to be tried where it was unzipped and thrown away.
  if (
    process.platform === "darwin" &&
    !is.dev &&
    APP_PREVIEW_NAME === undefined &&
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
  serveKeptState();
  servePageEditorBoot();

  await timeBootStep("setupBinDirectory", setupBinDirectory);

  // Detect whether the app was updated since the last launch so the renderer
  // can surface a one-time "updated" notification.
  await timeBootStep("checkRecentVersionBump", checkRecentVersionBump);

  const {
    actor: workspaceRef,
    browserViewManager,
    workspaceConfig,
  } = await timeBootStep("createWorkspaceActor", createWorkspaceActor);

  // A signed-in ChatGPT plan's access token lasts an hour.
  scheduleChatGPTPlanRefresh();
  powerMonitor.on("resume", refreshChatGPTPlanAfterWake);

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

  startAgentCompletionNotifications({
    hasAppWindow: () => getAppWindow() !== null,
    revealTask,
    workspaceConfig,
    workspaceRef,
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
  }

  registerFileDragHandler();

  await timeBootStep("initializeRPC", () => {
    initializeRPC({
      appUpdater: updater,
      browserViewManager,
      workspaceConfig,
      workspaceRef,
    });
  });

  if (shouldShowOnboarding()) {
    openOnboarding();
  } else {
    openAppWindow();
  }

  // Let the initial window render before running the best-effort cache warmup.
  setTimeout(() => {
    void warmCommonFileOpenTargets();
  }, 1500);

  // Nothing waits on this. It resolves once the GPU process has finished
  // reporting, which is the only point at which the answer is worth writing
  // down, and it is written for a support conversation rather than for the app.
  void logGpuStatus(app);

  void startAuthCallbackServer();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      if (shouldShowOnboarding()) {
        openOnboarding();
      } else {
        openAppWindow();
      }
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
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
  if (shouldShowOnboarding()) {
    openOnboarding();
    return;
  }
  ensureForegroundWindowVisible();
}

/**
 * A link from outside the app: the website's "Try in Instrument", a reply's
 * address pasted somewhere else. What it names is a screen of the window,
 * read the way a reply's link is.
 */
function handleDeepLink(url: string) {
  focusForegroundWindow();
  const link = instrumentLinkOf(url);
  if (link) {
    openAppScreen(link.href);
  }
}

/** Onboarding, with the app window loading off screen behind it. */
function openOnboarding() {
  warmAppWindowBehind(openOnboardingWindow());
}

function shouldShowOnboarding(): boolean {
  if (process.env.SKIP_ONBOARDING === "true") {
    return false;
  }
  return !getWorkspaceState().get("hasCompletedProviderSetup");
}

// Closing the last window quits, on macOS too. Staying resident is the macOS
// convention, but nothing here is meant to outlive its window: agents would
// keep running with no window to watch or stop them from, which reads as work
// the user already ended. The window's own close handler asks about running
// agents first, so this only ever runs once that is settled.
app.on("window-all-closed", () => {
  app.quit();
});

function applyThemeToWindows() {
  updateOnboardingWindowBackgroundColor();
  updateAppWindowBackgroundColor();
}
