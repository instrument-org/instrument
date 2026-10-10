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

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
 * asks once for com.github.Electron, and every clone shares that answer.
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
    const bundle = path.resolve(
      import.meta.dirname,
      "../node_modules/.cache/dev-electron",
      version,
      `${name.replaceAll(/[/:]/g, "-")}.app`,
    );
    const executable = path.join(bundle, "Contents/MacOS/Electron");
    if (existsSync(executable)) {
      return executable;
    }
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

ensureMacBridge();

const purpose = process.env.STUDIO_DRIVE_PURPOSE;
const electronExecPath = namedElectron(
  purpose ? `Instrument ${purpose}` : "Instrument (Dev)",
);

function start() {
  child = spawn(ELECTRON_VITE, process.argv.slice(2), {
    env: {
      ...process.env,
      INSTRUMENT_DEV_SUPERVISOR: "1",
      // electron-vite launches whatever this names in place of its own lookup.
      ...(electronExecPath && { ELECTRON_EXEC_PATH: electronExecPath }),
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
