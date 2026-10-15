// Puts Electron's binary in place for this checkout, as electron's own
// `install-electron` does, but on an Apple Silicon Mac from one unpacked copy
// in the user's cache directory, cloned instead of unpacked again.
//
// Unpacking the release zip writes about 300 MB of new files into every
// checkout, and agents working in worktrees make new checkouts daily. An APFS
// clone shares the copy's blocks, so a checkout after the first costs next to
// nothing. Whichever checkout installs a version first leaves the copy behind.
//
//   node scripts/install-electron.ts
//
// Anywhere else, and whenever one of electron's own install overrides is set,
// this is `install-electron` and nothing more.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";

const electronDir = path.dirname(
  createRequire(import.meta.url).resolve("electron/package.json"),
);

// Electron's installer reads these to fetch a different build or put it
// somewhere else, which a copy made for this Mac would not match.
const INSTALL_OVERRIDES = [
  "ELECTRON_INSTALL_ARCH",
  "ELECTRON_INSTALL_PLATFORM",
  "ELECTRON_OVERRIDE_DIST_PATH",
  "force_no_cache",
  "npm_config_arch",
  "npm_config_platform",
];

// A copy no checkout has installed from or into for this long goes. A clone
// outlives the copy it came from, so this never breaks a checkout.
const COPY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// What electron's installer writes to `path.txt` on macOS.
const EXECUTABLE = "Electron.app/Contents/MacOS/Electron";

function runInstaller() {
  execFileSync(process.execPath, [path.join(electronDir, "install.js")], {
    stdio: "inherit",
  });
}

// An x64 Node on an Apple Silicon Mac is running under Rosetta, where the
// installer fetches the arm64 build anyway; it keeps that judgment.
if (
  process.platform !== "darwin" ||
  process.arch !== "arm64" ||
  Object.entries(process.env).some(
    ([name, value]) => value && INSTALL_OVERRIDES.includes(name),
  )
) {
  runInstaller();
  process.exit(0);
}

// JSON.parse returns `any`; this is electron's own manifest.
const { version } = JSON.parse(
  readFileSync(path.join(electronDir, "package.json"), "utf8"),
) as { version: string };
const copyDir = path.join(
  homedir(),
  "Library/Caches/instrument-electron",
  `${version}-darwin-arm64`,
);

/** Whether `dir` holds this version's unpacked build, by the installer's own check. */
function holdsBuild(dir: string) {
  try {
    return (
      readFileSync(path.join(dir, "dist/version"), "utf8").replace(/^v/, "") ===
        version &&
      readFileSync(path.join(dir, "path.txt"), "utf8") === EXECUTABLE &&
      existsSync(path.join(dir, "dist", EXECUTABLE))
    );
  } catch {
    return false;
  }
}

/** Clones `from`'s build into `to`, which has none of its own. */
function cloneBuild(from: string, to: string) {
  rmSync(path.join(to, "dist"), { force: true, recursive: true });
  mkdirSync(to, { recursive: true });
  execFileSync("cp", ["-cR", path.join(from, "dist"), path.join(to, "dist")]);
  writeFileSync(path.join(to, "path.txt"), EXECUTABLE);
}

if (!holdsBuild(electronDir)) {
  let cloned = false;
  if (holdsBuild(copyDir)) {
    try {
      cloneBuild(copyDir, electronDir);
      cloned = holdsBuild(electronDir);
    } catch {
      // A volume that cannot clone, such as a checkout on another disk.
    }
  }
  if (!cloned) {
    runInstaller();
  }
}

// Leave a copy for the next checkout. Built aside and moved into place, so a
// second install running at the same moment never clones a half-made copy.
if (!holdsBuild(copyDir)) {
  const building = `${copyDir}.${process.pid}`;
  try {
    cloneBuild(electronDir, building);
    renameSync(building, copyDir);
  } catch (error) {
    rmSync(building, { force: true, recursive: true });
    if (!holdsBuild(copyDir)) {
      process.stderr.write(
        `[install-electron] could not keep a copy for other checkouts: ${String(error)}\n`,
      );
    }
  }
}

// Keep this version's copy fresh, and drop the copies of versions nobody has
// installed lately, along with anything a crashed install left half made.
if (holdsBuild(copyDir)) {
  utimesSync(copyDir, new Date(), new Date());
}
const copiesDir = path.dirname(copyDir);
for (const name of readdirSync(copiesDir)) {
  const dir = path.join(copiesDir, name);
  try {
    if (
      dir !== copyDir &&
      Date.now() - statSync(dir).mtimeMs > COPY_MAX_AGE_MS
    ) {
      rmSync(dir, { force: true, recursive: true });
    }
  } catch {
    // Another install dropped it first.
  }
}
