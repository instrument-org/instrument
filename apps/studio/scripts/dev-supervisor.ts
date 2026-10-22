// Runs `electron-vite` and starts it again when the app asks to be restarted.
//
// The app restarts itself to switch workspaces. A packaged build does that with
// `app.relaunch()`, but under `electron-vite dev` the Electron process is
// electron-vite's child, and electron-vite exits as soon as that child does,
// taking the renderer's dev server with it. So in dev the app exits with
// RELAUNCH_EXIT_CODE instead (see src/electron-main/lib/relaunch.ts), and this
// starts electron-vite over again with the same arguments and environment.
// Every other exit is passed through as it is.
//
//   node scripts/dev-supervisor.ts dev --sourcemap
//
// The `dev` script and studio-drive's `boot` both run electron-vite through
// this, so the process a launcher holds keeps the same pid across a restart.
//
// On macOS it also gives Electron the instance's name. The menu bar, Cmd-Tab,
// and the Dock name a running app by its bundle's CFBundleName, which
// `app.setName` does not reach, so every dev run read "Electron". The run goes
// through an APFS clone of Electron.app named for it instead: "Instrument
// hotkeys" for an instance studio-drive booted with that purpose, "Instrument
// (Dev)" for one started by hand.
//
// And it builds the Mac bridge when it is missing or stale (`mac-bridge.ts`),
// so every dev run has it however it was started.
//
// With STUDIO_OWN_PRIVACY set (studio-drive's `boot --own-privacy`), a Mac run
// starts Electron through `own-privacy.c`, so macOS answers it with the app's
// own privacy grants instead of those of the terminal that started it, which
// otherwise pass on Full Disk Access and hide every refusal. Electron stays in
// this process's group either way, so stopping the group stops it.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { ensureMacBridge } from "./mac-bridge.ts";

// Kept in step with DEV_RELAUNCH_EXIT_CODE in src/electron-main/lib/relaunch.ts.
const RELAUNCH_EXIT_CODE = 75;

// The bin shim rather than electron-vite's .js entry, because the shim is what
// exports the NODE_PATH into .pnpm that the config's `require.resolve` of
// ffmpeg-static and friends resolves through.
const ELECTRON_VITE = path.resolve(
  import.meta.dirname,
  "../node_modules/.bin",
  process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
);

let child: ChildProcess | undefined;
let stopping = false;

/**
 * The executable of an Electron.app clone carrying `name`, made on first use and
 * kept beside the dependencies, keyed by Electron's version so an upgrade starts
 * over. A clone costs no disk until written to, and only the outer bundle is
 * re-signed, since the Info.plist is all that changed. Undefined anywhere it
 * cannot be made, which leaves the run on Electron's own bundle.
 *
 * The re-sign is also what lets a dev run post notifications. Electron's own
 * bundle is only linker-signed, with no Info.plist bound and no sealed
 * resources, so it fails `codesign -v` and macOS refuses its request to
 * notify without ever asking. The clone's ad-hoc signature verifies, so macOS
 * asks once for the clone's bundle identifier.
 *
 * That identifier is the clone's own (`devBundleId`): macOS hands a click on
 * a notification to the app with the identifier that posted it, and with
 * every clone on com.github.Electron it could open another checkout's copy
 * instead. So each one has its own notification answer and Settings row, and
 * its own privacy grants under `--own-privacy`.
 *
 * macOS also opens a clone on its own, with no arguments: a click on its Dock
 * tile once the run is gone (the Dock can keep a dead run's tile), on one of
 * its notifications, or on a link in its URL scheme. Electron with no app to
 * load shows its stock welcome window, so the clone's `LSEnvironment`, which
 * only such an open applies, makes that launch plain Node, which exits at
 * once. electron-vite starts the executable directly and never sees it.
 */
function namedElectron(name: string) {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    const electronDir = path.dirname(
      createRequire(import.meta.url).resolve("electron/package.json"),
    );
    const stockBundle = path.join(electronDir, "dist/Electron.app");
    const version = readFileSync(
      path.join(electronDir, "dist/version"),
      "utf8",
    ).trim();
    const bundleId = devBundleId(name);
    const bundle = path.resolve(
      import.meta.dirname,
      "../node_modules/.cache/dev-electron",
      version,
      bundleId,
      `${name.replaceAll(/[/:]/g, "-")}.app`,
    );
    const executable = path.join(bundle, "Contents/MacOS/Electron");
    if (existsSync(executable)) {
      // A clone made before it quit when opened bare.
      if (quitWhenOpenedBare(path.join(bundle, "Contents/Info.plist"))) {
        execFileSync("codesign", ["--force", "--sign", "-", bundle], {
          stdio: "ignore",
        });
      }
      return executable;
    }
    // The clone an earlier layout kept straight under the version, on
    // com.github.Electron, which macOS would still offer a click to.
    rmSync(
      path.join(path.dirname(path.dirname(bundle)), path.basename(bundle)),
      {
        force: true,
        recursive: true,
      },
    );
    // Built aside and moved into place, so a second supervisor starting at the
    // same moment never launches a half-made bundle.
    const building = `${bundle}.${process.pid}`;
    rmSync(building, { force: true, recursive: true });
    mkdirSync(path.dirname(bundle), { recursive: true });
    execFileSync("cp", ["-cR", stockBundle, building]);
    const plist = path.join(building, "Contents/Info.plist");
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      execFileSync("plutil", ["-replace", key, "-string", name, plist]);
    }
    execFileSync("plutil", [
      "-replace",
      "CFBundleIdentifier",
      "-string",
      bundleId,
      plist,
    ]);
    quitWhenOpenedBare(plist);
    execFileSync("codesign", ["--force", "--sign", "-", building], {
      stdio: "ignore",
    });
    try {
      renameSync(building, bundle);
    } catch {
      // Another supervisor finished first; its bundle is the same.
      rmSync(building, { force: true, recursive: true });
    }
    return executable;
  } catch (error) {
    process.stderr.write(
      `[dev-supervisor] running as Electron, since a bundle named ${JSON.stringify(name)} could not be made: ${String(error)}\n`,
    );
    return;
  }
}

/**
 * Sets `ELECTRON_RUN_AS_NODE` in the bundle's `LSEnvironment`, beside the
 * `MallocNanoZone` Electron ships there. Answers whether it had to, which
 * leaves the bundle needing a new signature.
 */
function quitWhenOpenedBare(plist: string) {
  const keyPath = "LSEnvironment.ELECTRON_RUN_AS_NODE";
  try {
    execFileSync("plutil", ["-extract", keyPath, "raw", plist], {
      stdio: "ignore",
    });
    return false;
  } catch {
    execFileSync("plutil", ["-replace", keyPath, "-string", "1", plist]);
    return true;
  }
}

/**
 * A dev clone's bundle identifier: Electron's, then the checkout's folder
 * name and the instance's, so no two clones on the computer share one.
 */
function devBundleId(name: string) {
  const part = (words: string) =>
    words
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "");
  const checkout = path.basename(path.resolve(import.meta.dirname, "../../.."));
  return `com.github.Electron.${part(checkout)}.${part(name)}`;
}

ensureMacBridge();

/**
 * The launcher that starts a program as responsible for its own privacy
 * grants (`own-privacy.c`), built beside the dependencies whenever the source
 * is newer. Undefined anywhere it cannot be built, which fails the run rather
 * than quietly leaving it on the terminal's grants it was asked to be without.
 */
function ownPrivacyLauncher() {
  const source = path.resolve(import.meta.dirname, "own-privacy.c");
  const launcher = path.resolve(
    import.meta.dirname,
    "../node_modules/.cache/dev-electron/own-privacy",
  );
  try {
    if (
      !existsSync(launcher) ||
      statSync(launcher).mtimeMs < statSync(source).mtimeMs
    ) {
      mkdirSync(path.dirname(launcher), { recursive: true });
      execFileSync("clang", ["-O2", "-Wall", "-o", launcher, source]);
    }
    return launcher;
  } catch (error) {
    process.stderr.write(
      `[dev-supervisor] could not build the launcher for a run with its own privacy grants: ${String(error)}\n`,
    );
    process.exit(1);
  }
}

const purpose = process.env.STUDIO_DRIVE_PURPOSE;
const electronExecPath = namedElectron(
  purpose ? `Instrument ${purpose}` : "Instrument (Dev)",
);
const ownPrivacy =
  process.platform === "darwin" && process.env.STUDIO_OWN_PRIVACY === "1";
const launcher = ownPrivacy ? ownPrivacyLauncher() : undefined;

function start() {
  child = spawn(ELECTRON_VITE, process.argv.slice(2), {
    env: {
      ...process.env,
      INSTRUMENT_DEV_SUPERVISOR: "1",
      // electron-vite launches whatever this names in place of its own lookup.
      ...(electronExecPath && { ELECTRON_EXEC_PATH: electronExecPath }),
      ...(launcher && {
        ELECTRON_EXEC_PATH: launcher,
        OWN_PRIVACY_EXEC:
          electronExecPath ??
          path.join(
            path.dirname(
              createRequire(import.meta.url).resolve("electron/package.json"),
            ),
            "dist/Electron.app/Contents/MacOS/Electron",
          ),
      }),
    },
    // A .cmd shim only runs through a shell.
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (!stopping && code === RELAUNCH_EXIT_CODE) {
      process.stdout.write("\n[dev-supervisor] restarting electron-vite\n\n");
      start();
      return;
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}

start();
