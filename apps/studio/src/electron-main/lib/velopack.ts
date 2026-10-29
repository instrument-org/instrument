// The Windows app installs and updates through Velopack: Setup puts it in
// `%LOCALAPPDATA%\<APP_VELOPACK_ID>\`, with `Update.exe` and a launcher stub at
// the top and the app itself in `current\`, which every update replaces whole.
import { APP_FLAVOR, APP_PROTOCOL } from "@instrument-org/shared";
import { app } from "electron";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as Velopack from "velopack";

import {
  registeredOpenWithCommand,
  registerOpenWith,
  unregisterOpenWith,
} from "./windows-open-with";

/**
 * The folder Velopack installed this app into, or undefined for any other
 * install (NSIS, a development run, macOS, Linux). Told by the layout rather
 * than by anything recorded, so a copy moved elsewhere is taken for what it is.
 */
export function velopackRoot(): string | undefined {
  if (process.platform !== "win32") {
    return;
  }
  const appDir = path.dirname(process.execPath);
  const root = path.dirname(appDir);
  if (
    path.basename(appDir).toLowerCase() !== "current" ||
    !fs.existsSync(path.join(root, "Update.exe")) ||
    !fs.existsSync(path.join(appDir, "sq.version"))
  ) {
    return;
  }
  return root;
}

// A CommonJS package with a native addon, loaded only on a Velopack install.
export function loadVelopack(): typeof Velopack {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- require returns any
  return createRequire(import.meta.url)("velopack") as typeof Velopack;
}

// Open With is the shipping app's alone: a preview claims no file types, as
// its NSIS installer never did.
const claimsFileTypes = APP_FLAVOR.kind === "release";

/**
 * Answers Velopack's own launches of the app (installed, about to be
 * updated, updated, about to be uninstalled, which also takes out the app's
 * link protocol), each of which ends the process
 * once answered, before anything of the app loads. Velopack's launch of the
 * app also lands here and carries on.
 *
 * Velopack would otherwise apply a downloaded update at launch, before the
 * updater has checked its signature, so that is turned off: an update is
 * applied only by the updater, after the check.
 */
export function answerVelopackLaunch() {
  if (!velopackRoot()) {
    return;
  }
  const exePath = process.execPath;
  loadVelopack()
    .VelopackApp.build()
    .setAutoApplyOnStartup(false)
    .onAfterInstallFastCallback(() => {
      if (claimsFileTypes) {
        registerOpenWith(exePath);
      }
    })
    .onAfterUpdateFastCallback(() => {
      if (claimsFileTypes) {
        registerOpenWith(exePath);
      }
    })
    .onBeforeUninstallFastCallback(() => {
      if (claimsFileTypes) {
        unregisterOpenWith(exePath);
      }
      // Registered by every launch (index.ts); Electron removes it only
      // while it still names this executable.
      app.removeAsDefaultProtocolClient(APP_PROTOCOL);
    })
    .run();
}

/**
 * Puts Open With back when it names anything but this install: after moving
 * from the NSIS install, whose uninstaller took out the keys Velopack's Setup
 * had just written, or after another copy took them over. One registry read
 * on a normal launch.
 */
export function settleOpenWith() {
  if (!claimsFileTypes || !velopackRoot()) {
    return;
  }
  const expected = `"${process.execPath}" "%1"`;
  if (registeredOpenWithCommand()?.toLowerCase() !== expected.toLowerCase()) {
    registerOpenWith(process.execPath);
  }
}
