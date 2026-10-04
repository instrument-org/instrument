import { APP_BUNDLE_ID, APP_PREVIEW_NAME } from "@instrument-org/shared";
import { app, dialog, type MenuItemConstructorOptions } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";

import { logger } from "./electron-logger";

const log = logger.scope("previewReset");

// Runs after the app has quit, since nothing it erases can go while the app
// holds it open. Gives up rather than erasing anything if the quit was turned
// down (the running-agents warning) and the app is still up two minutes later.
const RESET_SCRIPT = String.raw`
pid="$1"; user_data="$2"; bundle_id="$3"; keychain_service="$4"; app_path="$5"
for _ in $(seq 1 600); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$pid" 2>/dev/null && exit 0
rm -rf "$user_data"
rm -rf "$HOME/Library/Saved Application State/$bundle_id.savedState"
defaults delete "$bundle_id" 2>/dev/null
while security delete-generic-password -s "$keychain_service" >/dev/null 2>&1; do :; done
tccutil reset All "$bundle_id"
open "$app_path"
`;

/**
 * The Preview menu, in a preview build on macOS: a way back to first launch
 * without a terminal, so whoever is trying the build can see onboarding again.
 */
export function previewMenu(): MenuItemConstructorOptions[] {
  if (APP_PREVIEW_NAME === undefined || process.platform !== "darwin") {
    return [];
  }
  return [
    {
      label: "Preview",
      submenu: [
        {
          click: () => {
            void confirmAndReset();
          },
          label: "Reset to First Run…",
        },
      ],
    },
  ];
}

async function confirmAndReset() {
  const { response } = await dialog.showMessageBox({
    buttons: ["Reset and Reopen", "Cancel"],
    cancelId: 1,
    defaultId: 0,
    detail:
      "Quits, erases this preview's data, keychain item, and macOS permissions, then reopens it as if installed for the first time. Notification permission stays; remove it in System Settings › Notifications. Files in Documents/Instrument stay too.",
    message: `Reset ${app.getName()} to its first run?`,
    type: "warning",
  });
  if (response !== 0) {
    return;
  }
  // The executable sits at <bundle>.app/Contents/MacOS/<name>.
  const appPath = path.resolve(app.getPath("exe"), "..", "..", "..");
  const args = [
    String(process.pid),
    app.getPath("userData"),
    APP_BUNDLE_ID,
    // The item Electron's safeStorage keeps its key in.
    `${app.getName()} Safe Storage`,
    appPath,
  ];
  log.info(`Resetting to first run: ${args.join(" ")}`);
  spawn("/bin/sh", ["-c", RESET_SCRIPT, "sh", ...args], {
    detached: true,
    stdio: "ignore",
  }).unref();
  app.quit();
}
