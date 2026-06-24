import { rgPath } from "@vscode/ripgrep";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { captureServerException } from "./capture-server-exception";

const BIN_DIR_NAME = "bin";

interface BinaryConfig {
  getTargetPath: () => string;
  name: string;
}

export function getPNPMBinPath(): string {
  return getNodeModulePath("pnpm", "bin", "pnpm.cjs");
}

// The uv binary is vendored into `resources/uv/` (see scripts/download-uv.ts),
// which electron-builder bundles and unpacks via `asarUnpack: ["resources/**"]`,
// so it is deep-signed alongside the app. Resolve it from the unpacked tree in
// prod and from the repo `resources/` dir in dev. Mirrors getNodeModulePath.
export function getUvBinPath(): string {
  const binaryName = process.platform === "win32" ? "uv.exe" : "uv";
  const appPath = app.getAppPath();
  const uvPath = path.join(appPath, "resources", "uv", binaryName);

  if (app.isPackaged && appPath.endsWith(".asar")) {
    return uvPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  }

  return uvPath;
}

// Added to PATH so that child processes (the users's apps) can access the binaries
// as if they were installed globally. We don't use these ourselves due to issues
// with orphaned processes on Windows.
export async function setupBinDirectory(): Promise<string> {
  const binDir = getBinDirectoryPath();

  await ensureDirectoryExists(binDir);
  await cleanBinDirectory(binDir);

  await setupNodeLink(binDir);

  const binaries = getBinaryConfigs();

  for (const binary of binaries) {
    try {
      const targetPath = binary.getTargetPath();

      try {
        await fs.access(targetPath);
      } catch {
        continue;
      }

      await linkDirect(binDir, binary.name, targetPath);
    } catch (error) {
      captureServerException(error, {
        scopes: ["studio"],
      });
    }
  }

  prependBinDirectoryToPath(binDir);

  return binDir;
}

async function cleanBinDirectory(binDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(binDir);

    for (const entry of entries) {
      const entryPath = path.join(binDir, entry);
      try {
        await fs.rm(entryPath, { force: true, recursive: true });
      } catch (error) {
        captureServerException(error, {
          scopes: ["studio"],
        });
      }
    }
  } catch (error) {
    captureServerException(error, { scopes: ["studio"] });
  }
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
    captureServerException(error, {
      scopes: ["studio"],
    });
    throw error;
  }
}

function getBinaryConfigs(): BinaryConfig[] {
  const isWindows = process.platform === "win32";

  return [
    {
      getTargetPath: () => getNodeModulePath("pnpm", "bin", "pnpm.cjs"),
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
  ];
}

function getBinDirectoryPath(): string {
  return path.join(app.getPath("userData"), BIN_DIR_NAME);
}

function getNodeModulePath(...parts: string[]): string {
  const appPath = app.getAppPath();
  const modulePath = path.join(appPath, "node_modules", ...parts);

  if (app.isPackaged && appPath.endsWith(".asar")) {
    const unpackedPath = modulePath.replace(
      /app\.asar([/\\])/,
      "app.asar.unpacked$1",
    );
    return unpackedPath;
  }

  return modulePath;
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

async function linkDirect(
  binDir: string,
  name: string,
  targetPath: string,
): Promise<void> {
  const isWindows = process.platform === "win32";

  if (isWindows) {
    const { default: cmdShim } = await import("@zkochan/cmd-shim");
    const outputPath = path.join(binDir, name);
    await cmdShim(targetPath, outputPath, {
      createCmdFile: true,
      createPwshFile: false,
    });
  } else {
    const linkPath = path.join(binDir, name);
    await fs.symlink(targetPath, linkPath);
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

async function setupNodeLink(binDir: string): Promise<void> {
  const isWindows = process.platform === "win32";
  const nodeExePath = process.execPath;

  try {
    if (isWindows) {
      await createNodeShim(binDir, nodeExePath);
    } else {
      const linkPath = path.join(binDir, "node");
      await fs.symlink(nodeExePath, linkPath);
    }
  } catch (error) {
    captureServerException(error, {
      scopes: ["studio"],
    });
    throw error;
  }
}
