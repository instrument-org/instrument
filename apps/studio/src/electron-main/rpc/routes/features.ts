import {
  computerPermissionStatus,
  isComputerUseReady,
  markComputerUseSetupResume,
  openComputerPermissionSettings,
  requestAccessibility,
  requestScreenRecording,
  verifyComputerUse,
} from "@/electron-main/lib/computer-driver";
import { canRelaunch, relaunchApp } from "@/electron-main/lib/relaunch";
import { liveRead } from "@instrument-org/workspace/electron";
import { getFeaturesStore } from "@/electron-main/stores/workspace/features";
import { getAppWindow } from "@/electron-main/windows/app-window";
import { FeatureNameSchema, FeaturesSchema } from "@/shared/features";
import { eventIterator } from "@orpc/server";
import { app, shell } from "electron";
import { z } from "zod";

import { base } from "../base";
import { publisher } from "../publisher";

const setEnabled = base
  .input(z.object({ enabled: z.boolean(), feature: FeatureNameSchema }))
  .handler(({ input }) => {
    const store = getFeaturesStore();
    store.set(input.feature, input.enabled);
  });

/**
 * Opens the App Management pane, which is what stands between the external
 * browser and working. Launching the user's installed Chrome makes macOS
 * attribute Chrome's writes to its own bundle back to us, so the first launch
 * raises "wants to manage apps on this Mac".
 *
 * Sending the user there is all we can do. macOS exposes no way to request
 * this consent: Electron's only permission entry points are
 * `askForMediaAccess` (camera and microphone) and `isTrustedAccessibilityClient`
 * (Accessibility), and the OS has no equivalent for App Management, nor any way
 * to read back whether it was granted. The prompt appears when Chrome writes,
 * not on demand, so the pane may show no row for this app until then.
 */
const openAppManagementSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    if (process.platform !== "darwin") {
      return { opened: false };
    }
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles",
    );
    return { opened: true };
  });

/**
 * The Files and Folders pane, where a folder the Mac refused this app is
 * granted after the fact. The system asks once, at the first read of a
 * protected folder, and never again for that folder: the pane's row is the
 * only way back once the ask was declined.
 */
const openFilesAndFoldersSettings = base
  .output(z.object({ opened: z.boolean() }))
  .handler(async () => {
    if (process.platform !== "darwin") {
      return { opened: false };
    }
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
    );
    return { opened: true };
  });

/**
 * The two grants Computer Use runs under on macOS, for the Settings card that
 * shows where each stands and asks for the missing one. Elsewhere there is
 * nothing to grant and every call answers `supported: false`.
 */
const computerUse = {
  /**
   * Brings the app back over System Settings once a switch the setup screen
   * is waiting on has been turned on there.
   */
  focus: base.handler(() => {
    const window = getAppWindow();
    if (window?.isMinimized()) {
      window.restore();
    }
    window?.show();
    app.focus({ steal: true });
  }),
  openSettings: base
    .input(
      z.object({ permission: z.enum(["accessibility", "screen-recording"]) }),
    )
    .handler(({ input }) => openComputerPermissionSettings(input.permission)),
  /**
   * Quit through the usual teardown and come back up: a Screen Recording
   * grant made in System Settings reaches only a process started after it.
   */
  relaunch: base.handler(async () =>
    canRelaunch()
      ? {
          outcome: await relaunchApp({
            beforeRestart: markComputerUseSetupResume,
          }),
        }
      : { outcome: "unsupported" as const },
  ),
  requestAccessibility: base.handler(() => requestAccessibility()),
  requestScreenRecording: base.handler(() => requestScreenRecording()),
  /**
   * Everything the setup screen shows: each grant, whether the agent is
   * offered the command, and the macOS major version, since the panes were
   * renamed in macOS 27.
   */
  status: base.handler(() => ({
    // What macOS calls the app in its prompts, which the screen mirrors.
    appName: app.getName(),
    canRelaunch: canRelaunch(),
    macOSMajor:
      process.platform === "darwin"
        ? Number.parseInt(process.getSystemVersion(), 10)
        : undefined,
    permissions: computerPermissionStatus(),
    ready: isComputerUseReady(),
  })),
  verify: base.handler(() => verifyComputerUse()),
};

const live = {
  getAll: base.output(eventIterator(FeaturesSchema)).handler(async function* ({
    signal,
  }) {
    yield* liveRead({
      changes: [publisher.subscribe("features.updated", { signal })],
      read: () => getFeaturesStore().store,
    });
  }),
};

export const features = {
  computerUse,
  live,
  openAppManagementSettings,
  openFilesAndFoldersSettings,
  setEnabled,
};
