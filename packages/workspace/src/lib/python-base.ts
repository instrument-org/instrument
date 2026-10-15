import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import { omit } from "radashi";

import { type ChatId } from "../schemas/chat-id";
import { filterShellOutput } from "./filter-shell-output";
import { inheritedEnv } from "./native-env";
import { withInstallerClosed } from "./native-sandbox";
import { PYTHON_BASE_REQUIREMENTS } from "./python-base-requirements";
import { ensureManagedPython } from "./run-uv";
import { uvPythonBaseDir, uvToolsEnvFor } from "./tool-isolation-env";
import { chatVenvDir, getUvBinPath, MANAGED_PYTHON_VERSION } from "./uv";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The packages `python-base/pyproject.toml` asks for, by the name a script
 * imports or the agent knows them by, as the agent is told about them.
 */
export const PYTHON_BASE_PACKAGES = [
  "pandas",
  "numpy",
  "matplotlib",
  "openpyxl",
  "pypdf",
  "pdfplumber",
  "pypdfium2",
  "Pillow",
  "python-docx",
  "python-pptx",
  "reportlab",
  "beautifulsoup4",
] as const;

/**
 * Part of the installed folder's name, so one installed a way this build no
 * longer installs is never taken for one it would.
 */
const BASE_FORMAT = 1;

/** Long enough to fetch about 75 MB of wheels on a slow connection. */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The file in a chat's virtualenv that puts the base packages on `sys.path`.
 * Python reads every `.pth` in site-packages at startup and appends each
 * line naming a folder, so the base comes after what the virtualenv itself
 * holds, and a version `pip install` put there wins.
 */
const PTH_FILE = "_instrument_python_base.pth";

const CACHE_DIR_NAME = "cache";

type PythonBaseFailure = { exitCode: number; output: string };

function baseRoot(): string {
  return uvPythonBaseDir(getWorkspaceConfig().uvDataDir);
}

/**
 * The folder holding the base packages, named by the hash of what defines
 * them, so a new package list or Python is installed beside the old rather
 * than over it.
 */
export function pythonBaseDir(): string {
  const hash = createHash("sha256");
  for (const part of [
    String(BASE_FORMAT),
    MANAGED_PYTHON_VERSION,
    PYTHON_BASE_REQUIREMENTS,
  ]) {
    hash.update(part);
    hash.update("\0");
  }
  return path.join(baseRoot(), hash.digest("hex").slice(0, 16));
}

/**
 * Whether the base packages are installed. The folder appears whole or not
 * at all, since it is renamed into place once its install has finished.
 */
export function pythonBaseReady(): boolean {
  return existsSync(pythonBaseDir());
}

let building: Promise<PythonBaseFailure | undefined> | undefined;

/**
 * Installs the base packages once a run of the app, after the managed
 * Python, and says why when it could not. Nothing waits on it: until it
 * lands, `python` has what `pip` installed, as it always had. A failure
 * (offline, say) is tried again by the next chat that makes its virtualenv,
 * and by the next launch.
 */
export function ensurePythonBase(): Promise<PythonBaseFailure | undefined> {
  if (pythonBaseReady()) {
    return Promise.resolve(undefined);
  }
  building ??= installPythonBase()
    .catch((error: unknown) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }))
    .then((failure) => {
      building = undefined;
      return failure;
    });
  return building;
}

/**
 * The locked wheels, each checked against the hash its lockfile records,
 * installed with their bytecode compiled into a folder of their own, since
 * no chat may write it later. Run as the app outside any chat's reach, like
 * the managed Python's install, which is safe because it runs none of a
 * chat's code and no package's (`--no-build`), from a cache no chat writes.
 * The folder is filled beside its final name and renamed into place.
 */
async function installPythonBase(): Promise<PythonBaseFailure | undefined> {
  const python = await ensureManagedPython();
  if (python) {
    return python;
  }
  const root = baseRoot();
  const target = pythonBaseDir();
  await fs.mkdir(root, { recursive: true });
  const staging = path.join(
    root,
    `.${path.basename(target)}.building-${process.pid}-${randomUUID()}`,
  );
  try {
    // The lockfile chose the versions, so the week-old release gate has
    // nothing to say about them.
    const uvEnv = omit(uvToolsEnvFor(getWorkspaceConfig().uvDataDir), [
      "UV_EXCLUDE_NEWER",
    ]);
    const spawned = withInstallerClosed(getUvBinPath(), [
      "pip",
      "install",
      "--target",
      staging,
      "--python",
      MANAGED_PYTHON_VERSION,
      "--require-hashes",
      "--no-build",
      "--compile-bytecode",
      "--requirement",
      "-",
    ]);
    const result = await execa(spawned.file, spawned.args, {
      all: true,
      cancelSignal: AbortSignal.timeout(BUILD_TIMEOUT_MS),
      env: {
        ...inheritedEnv(),
        ...uvEnv,
        UV_CACHE_DIR: path.join(root, CACHE_DIR_NAME),
        UV_PYTHON_DOWNLOADS: "never",
      },
      extendEnv: false,
      input: PYTHON_BASE_REQUIREMENTS,
      reject: false,
    });
    if (result.exitCode !== 0) {
      return {
        exitCode: result.exitCode ?? 1,
        output: filterShellOutput(
          result.all ||
            result.shortMessage ||
            "uv failed without diagnostic output.",
        ),
      };
    }
    if (!existsSync(target)) {
      await fs.rename(staging, target);
    }
    await removeSuperseded(root, path.basename(target));
    return undefined;
  } finally {
    await fs.rm(staging, { force: true, recursive: true });
  }
}

/**
 * Removes what an earlier package list installed, and what an install
 * left behind when its process ended mid-way. A chat's `.pth` that still
 * names an old folder is rewritten by its next command.
 */
async function removeSuperseded(root: string, current: string) {
  const entries = await fs.readdir(root).catch(() => []);
  for (const entry of entries) {
    const pid = /^\..+\.building-(\d+)-/.exec(entry)?.[1];
    const superseded =
      pid === undefined
        ? /^[0-9a-f]{16}$/.test(entry) && entry !== current
        : !processAlive(Number(pid));
    if (superseded) {
      await fs
        .rm(path.join(root, entry), { force: true, recursive: true })
        .catch(() => undefined);
    }
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** The chat's virtualenv's site-packages, as uv lays it out. */
function chatVenvSitePackages(chatId: ChatId): string {
  return process.platform === "win32"
    ? path.join(chatVenvDir(chatId), "Lib", "site-packages")
    : path.join(
        chatVenvDir(chatId),
        "lib",
        `python${MANAGED_PYTHON_VERSION}`,
        "site-packages",
      );
}

/**
 * Puts the base packages behind the chat's virtualenv, once they are
 * installed, by a `.pth` naming their folder. Rewritten whenever it names
 * another, so a chat made before a new package list follows it. Never fails
 * the command it runs for: a chat without it imports what `pip` installed.
 */
export async function linkPythonBase(chatId: ChatId): Promise<void> {
  const base = pythonBaseDir();
  if (!existsSync(base)) {
    return;
  }
  const pth = path.join(chatVenvSitePackages(chatId), PTH_FILE);
  const line = `${base}\n`;
  const current = await fs.readFile(pth, "utf8").catch(() => undefined);
  if (current !== line) {
    await fs.writeFile(pth, line).catch(() => undefined);
  }
}
