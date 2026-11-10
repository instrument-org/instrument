import { runtimeLayout } from "@instrument-org/workspace/electron";
import { rgPath } from "@vscode/ripgrep";
import { app } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { captureServerException } from "./capture-server-exception";
import { getAppUnpackedPath, getResourcePath } from "./resource-path";
import { getRuntimeDir } from "./runtime-dir";

interface BinaryConfig {
  getTargetPath: () => string;
  name: string;
}

// pnpm.mjs is pnpm's canonical entry (its package.json maps the `pnpm` bin to
// it) and the only executable one -- pnpm 11's bin/pnpm.cjs is a non-executable
// "older Corepack" compatibility shim. We fork this with node ourselves (where
// either would run), but the PATH shim below is exec'd directly by child
// processes, so it must be the executable .mjs.
export function getPNPMBinPath(): string {
  return getNodeModulePath("pnpm", "bin", "pnpm.mjs");
}

// The uv binary is vendored into `resources/uv/` (see scripts/download-uv.ts)
// so it is deep-signed alongside the app.
export function getUvBinPath(): string {
  const binaryName = process.platform === "win32" ? "uv.exe" : "uv";
  return getResourcePath("uv", binaryName);
}

// The uutils binaries are vendored into `resources/uutils/` (see
// scripts/download-uutils.ts) and deep-signed beside uv.
export function getUutilsDir(): string {
  return getResourcePath("uutils");
}

// MXC's launcher is vendored into `resources/mxc/` on Windows (see
// scripts/download-mxc.ts); undefined elsewhere or where it is missing.
export function getMxcExecPath(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const exec = getResourcePath("mxc", "wxc-exec.exe");
  return existsSync(exec) ? exec : undefined;
}

// Added to PATH so that child processes (the users's apps) can access the binaries
// as if they were installed globally. We don't use these ourselves due to issues
// with orphaned processes on Windows.
//
// The links are made again only when what they point at differs from what
// the last launch recorded in `LINKS_RECORD`, or one of them is gone: on a
// cold Windows disk wiping and writing the shims took seconds of the launch.
export async function setupBinDirectory(): Promise<string> {
  const binDir = runtimeLayout(getRuntimeDir()).bin;

  await ensureDirectoryExists(binDir);

  const links = await presentLinks();
  const record = JSON.stringify(links);
  if (!(await linksAreCurrent(binDir, links, record))) {
    await cleanBinDirectory(binDir);
    await setupNodeLink(binDir);

    for (const link of links.filter(({ name }) => name !== "node")) {
      try {
        await linkDirect(binDir, link.name, link.targetPath);
      } catch (error) {
        captureServerException(error);
      }
    }

    await fs
      .writeFile(path.join(binDir, LINKS_RECORD), record, "utf8")
      .catch(captureServerException);
  }

  prependBinDirectoryToPath(binDir);

  return binDir;
}

/** What the last launch linked, in the bin folder beside the links. */
const LINKS_RECORD = ".links.json";

type BinLink = { name: string; stamp?: string; targetPath: string };

/**
 * The bundled binaries this build has on disk, each with where it is. On
 * Windows each also names the size and time of the file it points at: a
 * hardlink is a second name for the file it was made from, so an update
 * that writes a new program at the same path leaves it naming the old one
 * until it is made again.
 */
async function presentLinks(): Promise<BinLink[]> {
  const links: BinLink[] = [];
  for (const binary of [
    { getTargetPath: () => process.execPath, name: "node" },
    ...getBinaryConfigs(),
  ]) {
    try {
      const targetPath = binary.getTargetPath();
      const stat = await fs.stat(targetPath);
      links.push({
        name: binary.name,
        ...(process.platform === "win32" && {
          stamp: `${stat.size}-${stat.mtimeMs}`,
        }),
        targetPath,
      });
    } catch {
      // Not in this build, or not on this platform.
    }
  }
  return links;
}

async function linksAreCurrent(
  binDir: string,
  links: { name: string }[],
  record: string,
): Promise<boolean> {
  const recorded = await fs
    .readFile(path.join(binDir, LINKS_RECORD), "utf8")
    .catch(() => undefined);
  if (recorded !== record) {
    return false;
  }
  const isWindows = process.platform === "win32";
  const present = await Promise.all(
    links.map((link) =>
      fs
        .lstat(path.join(binDir, isWindows ? `${link.name}.exe` : link.name))
        .catch(() =>
          isWindows ? fs.lstat(path.join(binDir, `${link.name}.cmd`)) : null,
        )
        .then(
          (stat) => stat !== null,
          () => false,
        ),
    ),
  );
  return present.every(Boolean);
}

async function cleanBinDirectory(binDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(binDir);

    for (const entry of entries) {
      const entryPath = path.join(binDir, entry);
      try {
        await fs.rm(entryPath, { force: true, recursive: true });
      } catch (error) {
        captureServerException(error);
      }
    }
  } catch (error) {
    captureServerException(error);
  }
}

/**
 * The files Electron reads from beside the program it was started as, which
 * a `node.exe` elsewhere needs beside it too, or it stops at startup.
 */
const ELECTRON_STARTUP_FILES = [
  "icudtl.dat",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
];

/**
 * `node.exe`, a hardlink to the app's own program, with the files it starts
 * from beside it, so a program that starts `node` without a shell (a Python
 * `subprocess.run(["node", ...])`) finds it: Windows starts only an `.exe`
 * by name, never a `.cmd`. A hardlink cannot reach another drive, so where
 * one cannot be made, a `node.cmd` shim, which a shell still finds.
 */
async function linkWindowsNode(
  binDir: string,
  nodeExePath: string,
): Promise<void> {
  const appDir = path.dirname(nodeExePath);
  try {
    await hardlink(nodeExePath, path.join(binDir, "node.exe"));
    for (const file of ELECTRON_STARTUP_FILES) {
      await hardlink(path.join(appDir, file), path.join(binDir, file));
    }
  } catch (error) {
    captureServerException(error);
    for (const file of ["node.exe", ...ELECTRON_STARTUP_FILES]) {
      await fs.rm(path.join(binDir, file), { force: true }).catch(() => {});
    }
    await createNodeShim(binDir, nodeExePath);
  }
}

async function hardlink(targetPath: string, linkPath: string): Promise<void> {
  await fs.rm(linkPath, { force: true });
  await fs.link(targetPath, linkPath);
}

async function createNodeShim(
  binDir: string,
  nodeExePath: string,
): Promise<void> {
  const shimCmdPath = path.join(binDir, "node.cmd");

  const shimContent = `@ECHO OFF
SETLOCAL
"${nodeExePath}" %*
`;

  await fs.writeFile(shimCmdPath, shimContent, "utf8");
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    captureServerException(error);
    throw error;
  }
}

function getBinaryConfigs(): BinaryConfig[] {
  const isWindows = process.platform === "win32";

  return [
    {
      getTargetPath: () => getNodeModulePath("pnpm", "bin", "pnpm.mjs"),
      name: "pnpm",
    },
    {
      getTargetPath: () => {
        const basePath = isWindows
          ? getNodeModulePath("dugite", "git", "cmd")
          : getNodeModulePath("dugite", "git", "bin");
        return isWindows
          ? path.join(basePath, "git.exe")
          : path.join(basePath, "git");
      },
      name: "git",
    },
    {
      getTargetPath: () => getRipgrepBinaryPath(),
      name: "rg",
    },
    // A chat's own commands put the bundled uv on PATH themselves; this is
    // for what runs without them, such as a package script `pnpm` runs.
    {
      getTargetPath: getUvBinPath,
      name: "uv",
    },
  ];
}

function getNodeModulePath(...parts: string[]): string {
  return getAppUnpackedPath("node_modules", ...parts);
}

// Since @vscode/ripgrep 1.18.0 the binary ships in a per-platform package
// (@vscode/ripgrep-<platform>-<arch>) resolved via `rgPath`. Rewrite the path
// into the unpacked tree so it is executable from a packaged asar.
function getRipgrepBinaryPath(): string {
  if (app.isPackaged && rgPath.includes(`app.asar${path.sep}`)) {
    return rgPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  }
  return rgPath;
}

/**
 * Programs that run from any folder, linked on Windows as an `.exe` that a
 * program starting them without a shell finds. git is not one: dugite's
 * `git.exe` finds the rest of git from where it is.
 */
const HARDLINKED = new Set(["rg", "uv"]);

async function linkDirect(
  binDir: string,
  name: string,
  targetPath: string,
): Promise<void> {
  const isWindows = process.platform === "win32";

  if (isWindows && HARDLINKED.has(name)) {
    try {
      await hardlink(targetPath, path.join(binDir, `${name}.exe`));
      return;
    } catch (error) {
      // Another drive: a shim, which a shell still finds.
      captureServerException(error);
    }
  }
  if (isWindows) {
    const { default: cmdShim } = await import("@zkochan/cmd-shim");
    const outputPath = path.join(binDir, name);
    await cmdShim(targetPath, outputPath, {
      createCmdFile: true,
      createPwshFile: false,
    });
  } else {
    await replaceSymlink(targetPath, path.join(binDir, name));
  }
}

function prependBinDirectoryToPath(binDir: string): void {
  const currentPath = process.env.PATH || "";
  const pathSeparator = path.delimiter;

  const pathParts = currentPath.split(pathSeparator).filter(Boolean);

  const binDirIndex = pathParts.indexOf(binDir);
  if (binDirIndex !== -1) {
    pathParts.splice(binDirIndex, 1);
  }

  const newPath = [binDir, ...pathParts].join(pathSeparator);

  process.env.PATH = newPath;
}

// An entry can already be present when the link is attempted: development
// instances share this directory, so another boot's relink can land between
// this boot's wipe and its own, and a file the wipe could not remove is still
// in place. Replace what is there, and treat losing the race to another
// instance's identical link as success.
async function replaceSymlink(
  targetPath: string,
  linkPath: string,
): Promise<void> {
  await fs.rm(linkPath, { force: true });
  try {
    await fs.symlink(targetPath, linkPath);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "EEXIST") {
      throw error;
    }
  }
}

async function setupNodeLink(binDir: string): Promise<void> {
  const isWindows = process.platform === "win32";
  const nodeExePath = process.execPath;

  try {
    await (isWindows
      ? linkWindowsNode(binDir, nodeExePath)
      : replaceSymlink(nodeExePath, path.join(binDir, "node")));
  } catch (error) {
    // The node link is a PATH convenience for user-app child processes, the
    // same as the pnpm/git/rg links, so losing it degrades those processes
    // rather than the launch.
    captureServerException(error);
  }
}
