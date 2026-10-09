import { APP_BUNDLE_ID, APP_FLAVOR } from "@instrument-org/shared";
import { app, dialog, type MenuItemConstructorOptions } from "electron";
import { spawn } from "node:child_process";

import { logger } from "./electron-logger";

const log = logger.scope("previewReset");

// Each runs after the app has quit, since nothing it erases can go while the
// app holds it open. Each gives up rather than erasing anything if the quit was
// turned down (the running-agents warning) and the app is still up two minutes
// later. They read what to erase from the environment.
const MAC_RESET_SCRIPT = String.raw`
for _ in $(seq 1 600); do
  kill -0 "$RESET_PID" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$RESET_PID" 2>/dev/null && exit 0
rm -rf "$RESET_USER_DATA"
rm -rf "$HOME/Library/Saved Application State/$RESET_BUNDLE_ID.savedState"
defaults delete "$RESET_BUNDLE_ID" 2>/dev/null
while security delete-generic-password -s "$RESET_KEYCHAIN_SERVICE" >/dev/null 2>&1; do :; done
tccutil reset All "$RESET_BUNDLE_ID"
open -b "$RESET_BUNDLE_ID"
`;

const LINUX_RESET_SCRIPT = String.raw`
for _ in $(seq 1 600); do
  kill -0 "$RESET_PID" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$RESET_PID" 2>/dev/null && exit 0
rm -rf "$RESET_USER_DATA"
setsid "$RESET_RELAUNCH" >/dev/null 2>&1 &
`;

// Helper processes can hold a file in userData for a moment after the main
// process exits, so the removal is retried before reopening.
const WINDOWS_RESET_SCRIPT = String.raw`
$target = [int]$env:RESET_PID
$deadline = (Get-Date).AddMinutes(2)
while (Get-Process -Id $target -ErrorAction SilentlyContinue) {
  if ((Get-Date) -gt $deadline) { exit 0 }
  Start-Sleep -Milliseconds 200
}
for ($i = 0; $i -lt 25 -and (Test-Path -LiteralPath $env:RESET_USER_DATA); $i++) {
  Remove-Item -LiteralPath $env:RESET_USER_DATA -Recurse -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 200
}
Start-Process -FilePath $env:RESET_RELAUNCH
`;

/**
 * The Preview menu, in a preview build on macOS, where the menu bar is always
 * on screen. Every platform also has the same command in the dev panel, which
 * a preview shows from its first launch.
 */
export function previewMenu(): MenuItemConstructorOptions[] {
  if (APP_FLAVOR.kind !== "preview" || process.platform !== "darwin") {
    return [];
  }
  return [
    {
      label: "Preview",
      submenu: [
        {
          click: () => {
            void resetPreviewToFirstRun();
          },
          label: "Reset to First Run…",
        },
      ],
    },
  ];
}

/**
 * A way back to first launch without a terminal, so whoever is trying a
 * preview can see onboarding again. Asks first, then quits and hands the
 * erasing to a process that outlives the app.
 */
export async function resetPreviewToFirstRun() {
  if (APP_FLAVOR.kind !== "preview") {
    return;
  }
  const { response } = await dialog.showMessageBox({
    buttons: ["Reset and Reopen", "Cancel"],
    cancelId: 1,
    defaultId: 0,
    detail:
      process.platform === "darwin"
        ? "Quits, erases this preview's data, keychain item, and macOS permissions, then reopens it as if installed for the first time. Notification permission stays; remove it in System Settings › Notifications. Files in Documents/Instrument stay too."
        : "Quits, erases this preview's data, then reopens it as if installed for the first time. Files in Documents/Instrument stay.",
    message: `Reset ${app.getName()} to its first run?`,
    type: "warning",
  });
  if (response !== 0) {
    return;
  }
  const env = {
    ...process.env,
    RESET_BUNDLE_ID: APP_BUNDLE_ID,
    // The item Electron's safeStorage keeps its key in on macOS.
    RESET_KEYCHAIN_SERVICE: `${app.getName()} Safe Storage`,
    RESET_PID: String(process.pid),
    // An AppImage runs from a mount that goes away with the app, so it is
    // reopened from the file it was started from.
    RESET_RELAUNCH: process.env.APPIMAGE ?? process.execPath,
    RESET_USER_DATA: app.getPath("userData"),
  };
  log.info(
    `Resetting to first run: ${env.RESET_USER_DATA}, reopening ${env.RESET_RELAUNCH}`,
  );
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_RESET_SCRIPT,
          ],
        ]
      : [
          "/bin/sh",
          [
            "-c",
            process.platform === "darwin"
              ? MAC_RESET_SCRIPT
              : LINUX_RESET_SCRIPT,
          ],
        ];
  spawn(command, args, {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  app.quit();
}
