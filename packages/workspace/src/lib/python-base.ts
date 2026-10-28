import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { z } from "zod";

import { type AbsolutePath } from "../schemas/paths";
import { filterShellOutput } from "./filter-shell-output";
import { readJsonRecordSync, updateJsonRecord } from "./json-record-file";
import { inheritedEnv } from "./native-env";
import {
  appNativeReach,
  launchNative,
  withInstallerClosed,
  wrapNativeCommand,
} from "./native-sandbox";
import { runtimeLayout } from "./runtime-dir";
import { ensureManagedPython } from "./run-uv";
import { RELEASE_AGE_DAYS, uvToolsEnvFor } from "./tool-isolation-env";
import { getUvBinPath, MANAGED_PYTHON_VERSION, venvSitePackages } from "./uv";
import { replaceFileIn } from "./capabilities/runtime-file";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The packages `PYTHON_BASE_SPEC` asks for, by the name a script imports or
 * the agent knows them by, as the agent is told about them.
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
 * The packages every chat's `python` imports without a `pip install`: the
 * ones the agent reached for most in real chats and failed to import, for
 * the charts, spreadsheets, PDFs and documents it is asked for most. Each is
 * held below its next major version, so a refresh never changes an API the
 * models know; a release raises a ceiling to take a new major. `smoke` is
 * the module a new set must import before chats are pointed at it.
 */
export const PYTHON_BASE_SPEC = [
  // Reading web pages saved or fetched as HTML.
  { requirement: "beautifulsoup4>=4,<5", smoke: "bs4" },
  // Charts, the most common failed import.
  { requirement: "matplotlib>=3,<4", smoke: "matplotlib" },
  // pandas brings it; named so its major is held too.
  { requirement: "numpy>=2,<3", smoke: "numpy" },
  // Reading and writing .xlsx, and pandas' engine for it.
  { requirement: "openpyxl>=3,<4", smoke: "openpyxl" },
  // CSV and table work, the most common kind of script.
  { requirement: "pandas>=3,<4", smoke: "pandas" },
  // Text and tables out of a PDF.
  { requirement: "pdfplumber>=0.11,<1", smoke: "pdfplumber" },
  // Images: resizing, converting, thumbnails.
  { requirement: "pillow>=12,<13", smoke: "PIL.Image" },
  // Splitting, merging, filling and rotating PDFs.
  { requirement: "pypdf>=6,<7", smoke: "pypdf" },
  // Rendering PDF pages to images, under a permissive license (PyMuPDF is
  // AGPL).
  { requirement: "pypdfium2>=5,<6", smoke: "pypdfium2" },
  { requirement: "python-docx>=1,<2", smoke: "docx" },
  // Brings xlsxwriter.
  { requirement: "python-pptx>=1,<2", smoke: "pptx" },
  // Writing a PDF from scratch.
  { requirement: "reportlab>=5,<6", smoke: "reportlab.pdfgen.canvas" },
] as const;

/**
 * Part of every set's folder name and of the spec's hash, so a set
 * installed a way this build no longer installs is never taken for one it
 * would.
 */
const BASE_FORMAT = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a set that matches the spec is kept before a `python`, `pip` or
 * `uv` command checks for a newer one, and how long a failed check waits.
 * The same week as the release-age gate, so a check finds what aged in.
 */
const REFRESH_INTERVAL_MS = RELEASE_AGE_DAYS * DAY_MS;

/**
 * How long a failed check waits when there is no set for this spec yet,
 * since every chat goes without the packages until one lands.
 */
const RETRY_WITHOUT_SET_MS = 5 * 60 * 1000;

const RESOLVE_TIMEOUT_MS = 2 * 60 * 1000;

/** Long enough to fetch about 75 MB of wheels on a slow connection. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

const SMOKE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * The file in a chat's virtualenv that puts the base packages on `sys.path`.
 * Python reads every `.pth` in site-packages at startup and appends each
 * line naming a folder that exists, so the base comes after what the
 * virtualenv itself holds, and a version `pip install` put there wins.
 */
const PTH_FILE = "_instrument_python_base.pth";

const CACHE_DIR_NAME = "cache";

/** Which set chats use, and when the spec was last checked against PyPI. */
const STATE_FILE = "state.json";

/** Held by the one process refreshing the set on this machine. */
const LOCK_FILE = "refresh.lock";

const SET_NAME = /^[0-9a-f]{16}$/;

const StateSchema = z.object({
  /** When a check last resolved the spec, whatever it found. */
  checkedAt: z.number().optional(),
  /** When a check last failed, so the next waits its turn. */
  failedAt: z.number().optional(),
  /** The folder chats are pointed at. */
  set: z.string().regex(SET_NAME).optional(),
  /** The hash of the spec `set` was resolved from. */
  spec: z.string().optional(),
});

type PythonBaseState = z.output<typeof StateSchema>;

type PythonBaseFailure = { exitCode: number; output: string };

function baseRoot(): string {
  return runtimeLayout(getWorkspaceConfig().runtimeDir).pythonBase;
}

function hashOf(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function specText(): string {
  return `${PYTHON_BASE_SPEC.map(({ requirement }) => requirement).join("\n")}\n`;
}

function specHash(): string {
  return hashOf([String(BASE_FORMAT), MANAGED_PYTHON_VERSION, specText()]);
}

function stateFile(): string {
  return path.join(baseRoot(), STATE_FILE);
}

function readState(): PythonBaseState {
  const read = readJsonRecordSync(stateFile());
  const parsed =
    read.kind === "read" ? StateSchema.safeParse(read.record) : undefined;
  return parsed?.success ? parsed.data : {};
}

/**
 * Writes `changes` over the state. One that cannot be read is replaced
 * rather than refused, since all it holds is when to check next.
 */
async function writeState(changes: PythonBaseState) {
  const file = stateFile();
  if (readJsonRecordSync(file).kind === "unreadable") {
    await fs.rm(file, { force: true });
  }
  await updateJsonRecord(file, () => changes);
}

/**
 * The folder holding the set chats are pointed at, once one is installed.
 * Each set's folder is named by the hash of the versions in it, so a new
 * one is installed beside the old rather than over it.
 */
export function pythonBaseDir(): string | undefined {
  const { set } = readState();
  if (set === undefined) {
    return undefined;
  }
  const dir = path.join(baseRoot(), set);
  return existsSync(dir) ? dir : undefined;
}

/**
 * Whether a set is installed. A folder appears whole or not at all, since
 * it is renamed into place once its install and import check have passed.
 */
export function pythonBaseReady(): boolean {
  return pythonBaseDir() !== undefined;
}

function hasSetForSpec(state: PythonBaseState): boolean {
  return (
    state.spec === specHash() &&
    state.set !== undefined &&
    existsSync(path.join(baseRoot(), state.set))
  );
}

/**
 * Whether a check is due: a week after the last one when the set matches
 * the spec. With no set for it (none yet, or one resolved from the spec of
 * an earlier release), at once, or a few minutes after a failure.
 */
function refreshDue(state: PythonBaseState, now: number): boolean {
  return hasSetForSpec(state)
    ? now - Math.max(state.checkedAt ?? 0, state.failedAt ?? 0) >=
        REFRESH_INTERVAL_MS
    : now - (state.failedAt ?? 0) >= RETRY_WITHOUT_SET_MS;
}

let refreshing: Promise<PythonBaseFailure | undefined> | undefined;

function refresh(): Promise<PythonBaseFailure | undefined> {
  refreshing ??= withMachineLock(refreshPythonBase)
    .catch((error: unknown) => ({
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    }))
    .then((failure) => {
      refreshing = undefined;
      return failure;
    });
  return refreshing;
}

/**
 * At launch: removes every set but the one chats are pointed at, since no
 * script from an earlier run is left to need the one it replaced, then
 * installs a set when there is none for this spec, or checks for a newer
 * one when the last check is a week old. Says why when it could not. Nothing
 * waits on it: until a set lands, `python` has what `pip` installed.
 */
export async function ensurePythonBase(): Promise<
  PythonBaseFailure | undefined
> {
  const state = readState();
  await removeSuperseded(new Set(state.set === undefined ? [] : [state.set]));
  return hasSetForSpec(state) && !refreshDue(state, Date.now())
    ? undefined
    : refresh();
}

/**
 * Starts a check in the background when one is due, for a chat's `python`,
 * `pip` or `uv` command, which never waits on it. A failure is logged and
 * leaves the set as it was.
 */
/**
 * Asks for a check of the base packages when one is due. The bash worker
 * replaces it with a request to the main thread, so one thread owns the
 * refresh and the processes it starts.
 */
let requestRefresh = refreshPythonBaseIfDue;

export function setPythonBaseRefresher(next: () => void): void {
  requestRefresh = next;
}

/** What a `python`, `pip` or `uv` command asks, wherever it runs. */
export function askForPythonBaseRefresh(): void {
  requestRefresh();
}

export function refreshPythonBaseIfDue(): void {
  if (refreshing || !refreshDue(readState(), Date.now())) {
    return;
  }
  void refresh().then((failure) => {
    if (failure) {
      console.warn("Could not refresh the base Python packages", failure);
    }
  });
}

/**
 * Runs `run` while this process holds the machine's refresh lock, so two
 * instances of the app sharing uv's data folder never refresh at once.
 * Another live holder means a refresh is already under way, and this one
 * is skipped; a holder that died leaves a lock the next one takes over.
 */
async function withMachineLock(
  run: () => Promise<PythonBaseFailure | undefined>,
): Promise<PythonBaseFailure | undefined> {
  const root = baseRoot();
  await fs.mkdir(root, { recursive: true });
  const lock = path.join(root, LOCK_FILE);
  for (const attempt of [0, 1]) {
    try {
      await fs.writeFile(lock, String(process.pid), { flag: "wx" });
    } catch (error) {
      if (!isCode(error, "EEXIST") || attempt === 1) {
        throw error;
      }
      const holder = Number(await fs.readFile(lock, "utf8").catch(() => ""));
      const age = await fs
        .stat(lock)
        .then((stat) => Date.now() - stat.mtimeMs)
        .catch(() => 0);
      if (
        processAlive(holder) &&
        age < RESOLVE_TIMEOUT_MS + INSTALL_TIMEOUT_MS + SMOKE_TIMEOUT_MS
      ) {
        return undefined;
      }
      await fs.rm(lock, { force: true });
      continue;
    }
    try {
      return await run();
    } finally {
      await fs.rm(lock, { force: true });
    }
  }
  return undefined;
}

/**
 * Resolves the spec against PyPI, held to releases a week old like every
 * install a chat runs, and when that names other versions than the current
 * set, installs them beside it, checks every package imports, and only then
 * points chats at the new set. Any failure leaves the current set in place
 * and records when, so the next check waits its turn.
 */
async function refreshPythonBase(): Promise<PythonBaseFailure | undefined> {
  const now = Date.now();
  const state = readState();
  const failed = async (failure: PythonBaseFailure) => {
    await writeState({ failedAt: now });
    return failure;
  };
  const python = await ensureManagedPython();
  if (python) {
    return failed(python);
  }
  const resolved = await resolveSpec(now);
  if ("exitCode" in resolved) {
    return failed(resolved);
  }
  const set = hashOf([
    String(BASE_FORMAT),
    MANAGED_PYTHON_VERSION,
    resolved.pins,
  ]);
  if (!existsSync(path.join(baseRoot(), set))) {
    const installed = await installSet(set, resolved.pins, now);
    if (installed) {
      return failed(installed);
    }
  }
  await writeState({
    checkedAt: now,
    failedAt: undefined,
    set,
    spec: specHash(),
  });
  // The set it replaced stays for a script still running from it; any
  // older one goes, so the disk holds at most one set beside the current.
  await removeSuperseded(
    new Set(
      state.set === undefined || state.set === set ? [set] : [set, state.set],
    ),
  );
  return undefined;
}

/**
 * The app's uv, outside any chat's reach like the managed Python's install,
 * which is safe because it runs no package's code (`--no-build`), from a
 * cache no chat writes.
 */
function runAppUv(
  args: readonly string[],
  options: { input?: string; now: number; timeoutMs: number },
) {
  const spawned = withInstallerClosed(getUvBinPath(), args);
  return execa(spawned.file, spawned.args, {
    all: true,
    cancelSignal: AbortSignal.timeout(options.timeoutMs),
    env: {
      ...inheritedEnv(),
      // `UV_EXCLUDE_NEWER` among them: the week-old release gate a chat's
      // `pip` is held to, and pnpm's `minimumReleaseAge`.
      ...uvToolsEnvFor(getWorkspaceConfig().runtimeDir, new Date(options.now)),
      UV_CACHE_DIR: path.join(baseRoot(), CACHE_DIR_NAME),
      UV_PYTHON_DOWNLOADS: "never",
    },
    extendEnv: false,
    reject: false,
    ...(options.input === undefined
      ? { stdin: "ignore" as const }
      : { input: options.input }),
  });
}

function failureOf(result: {
  all?: string;
  exitCode?: number;
  shortMessage?: string;
}): PythonBaseFailure {
  return {
    exitCode: result.exitCode || 1,
    output: filterShellOutput(
      result.all ||
        result.shortMessage ||
        "uv failed without diagnostic output.",
    ),
  };
}

/** Every package the spec brings, pinned, for this platform's wheels. */
async function resolveSpec(
  now: number,
): Promise<PythonBaseFailure | { pins: string }> {
  const result = await runAppUv(
    [
      "pip",
      "compile",
      "--python",
      MANAGED_PYTHON_VERSION,
      "--no-build",
      "--no-header",
      "--no-annotate",
      "--quiet",
      "-",
    ],
    { input: specText(), now, timeoutMs: RESOLVE_TIMEOUT_MS },
  );
  return result.exitCode === 0 && result.stdout.trim()
    ? { pins: `${result.stdout.trim()}\n` }
    : failureOf(result);
}

/**
 * Installs `pins` with their bytecode compiled into a folder of their own,
 * since no chat may write it later, checks them, and renames the folder
 * into place.
 */
async function installSet(
  set: string,
  pins: string,
  now: number,
): Promise<PythonBaseFailure | undefined> {
  const root = baseRoot();
  const staging = path.join(
    root,
    `.${set}.building-${process.pid}-${randomUUID()}`,
  );
  try {
    const result = await runAppUv(
      [
        "pip",
        "install",
        "--target",
        staging,
        "--python",
        MANAGED_PYTHON_VERSION,
        "--no-build",
        "--compile-bytecode",
        "--requirement",
        "-",
      ],
      { input: pins, now, timeoutMs: INSTALL_TIMEOUT_MS },
    );
    if (result.exitCode !== 0) {
      return failureOf(result);
    }
    const smoke = await importEverything(staging, now);
    if (smoke) {
      return smoke;
    }
    await fs.rename(staging, path.join(root, set));
    return undefined;
  } finally {
    await fs.rm(staging, { force: true, recursive: true });
  }
}

/**
 * Imports one module from every package in `dir` with the managed Python,
 * as a chat's `.pth` would put it on the path. This runs the packages' own
 * code, so it is held like any native command the app starts.
 */
async function importEverything(
  dir: string,
  now: number,
): Promise<PythonBaseFailure | undefined> {
  const found = await runAppUv(["python", "find", MANAGED_PYTHON_VERSION], {
    now,
    timeoutMs: SMOKE_TIMEOUT_MS,
  });
  const python = found.stdout.trim();
  if (found.exitCode !== 0 || !python) {
    return failureOf(found);
  }
  // Packages write config and caches on import (matplotlib's under
  // ~/.matplotlib), and fall back to the temp folder when they cannot, so
  // the check gets a temp folder of its own it may change.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "python-base-"));
  try {
    const spawned = wrapNativeCommand(
      python,
      [
        "-I",
        "-B",
        "-c",
        `import sys; sys.path.append(${JSON.stringify(dir)}); ${PYTHON_BASE_SPEC.map(({ smoke }) => `import ${smoke}`).join("; ")}`,
      ],
      appNativeReach([temp]),
    );
    const env = {
      ...inheritedEnv(process.env, spawned),
      MPLBACKEND: "Agg",
      TMPDIR: temp,
    };
    const launch = launchNative(spawned, { env });
    const result = await execa(launch.file, launch.args, {
      all: true,
      cancelSignal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
      env,
      extendEnv: false,
      reject: false,
      stdin: "ignore",
    });
    return result.exitCode === 0 ? undefined : failureOf(result);
  } finally {
    await fs.rm(temp, { force: true, recursive: true });
  }
}

/**
 * Removes every set not in `keep`, and what an install left behind when
 * its process ended mid-way. A chat's `.pth` that names a removed set is
 * rewritten by its next command, and until then Python skips it.
 */
async function removeSuperseded(keep: ReadonlySet<string>) {
  const root = baseRoot();
  const entries = await fs.readdir(root).catch(() => []);
  for (const entry of entries) {
    const pid = /^\..+\.building-(\d+)-/.exec(entry)?.[1];
    const superseded =
      pid === undefined
        ? SET_NAME.test(entry) && !keep.has(entry)
        : !processAlive(Number(pid));
    if (superseded) {
      await fs
        .rm(path.join(root, entry), { force: true, recursive: true })
        .catch(() => undefined);
    }
  }
}

function isCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

function processAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

/**
 * Puts the current set behind a virtualenv, once one is installed, by a `.pth` naming its folder. Rewritten whenever it names
 * another, so a chat follows a new set from its next command, while a
 * script already running keeps the set it started with. Never fails the
 * command it runs for: a chat without it imports what `pip` installed.
 */
export async function linkPythonBase(venv: AbsolutePath): Promise<void> {
  const base = pythonBaseDir();
  if (base === undefined) {
    return;
  }
  const pth = path.join(venvSitePackages(venv), PTH_FILE);
  await replaceFileIn(pth, `${base}\n`).catch(() => undefined);
}
