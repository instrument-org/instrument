import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { type AbsolutePath, AbsolutePathSchema } from "../schemas/paths";
import { getIgnore } from "./get-ignore";
import { canonicalizeThroughMissing, hostPathWithin } from "./host-path";
import { normalizePath } from "./normalize-path";
import { runPnpmCommand } from "./run-pnpm";
import { ensureManagedPython, runUvCommand } from "./run-uv";
import { runtimeLayout } from "./runtime-dir";
import { SKILL_COPY_IGNORE } from "./skill-artifact-ignore";
import { getSkillPackageFingerprint } from "./skill-package-fingerprint";
import { MANAGED_PYTHON_VERSION, nearestVenv, venvPython } from "./uv";
import { hasUsableVenv, type VenvError } from "./venv";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Part of every environment's name, so one built a way this build no longer
 * builds is never taken for one it would.
 */
const ENVIRONMENT_FORMAT = 1;

/** Long enough for a cold cache to fetch a skill's wheels on a slow connection. */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

const PYTHON_PROJECT_FILE = "pyproject.toml";
const PYTHON_LOCKFILE = "uv.lock";
const NODE_MODULES = "node_modules";

function environmentsDir(): AbsolutePath {
  return AbsolutePathSchema.parse(
    runtimeLayout(getWorkspaceConfig().runtimeDir).environments,
  );
}

function environmentDir(...parts: string[]): AbsolutePath {
  const hash = createHash("sha256");
  for (const part of [String(ENVIRONMENT_FORMAT), ...parts]) {
    hash.update(part);
    hash.update("\0");
  }
  return AbsolutePathSchema.parse(
    path.join(environmentsDir(), hash.digest("hex").slice(0, 16)),
  );
}

/**
 * The Python environment for a skill's locked dependencies, in the runtime
 * folder's `environments/`, named by the hash of its `uv.lock` and the
 * managed Python's version, so every skill locking the same set shares one.
 * Undefined for a skill with no `pyproject.toml` and `uv.lock`.
 */
export function pythonEnvironmentOf(
  skillDir: string,
): AbsolutePath | undefined {
  if (!existsSync(path.join(skillDir, PYTHON_PROJECT_FILE))) {
    return undefined;
  }
  let lockfile: string;
  try {
    lockfile = readFileSync(path.join(skillDir, PYTHON_LOCKFILE), "utf8");
  } catch {
    return undefined;
  }
  return environmentDir("python", MANAGED_PYTHON_VERSION, lockfile);
}

/**
 * The folder of a skill the app sets up dependencies for that holds
 * `hostPath`: one the app ships (the runtime folder's `skills/`), a Node
 * skill's built copy (its `environments/`), or one of the workspace's own.
 * A skill from another agent's folder is not one: the app runs none of its
 * declared installs unasked.
 */
export function trustedSkillFolder(hostPath: string): AbsolutePath | undefined {
  const runtime = runtimeLayout(getWorkspaceConfig().runtimeDir);
  const roots = [runtime.skills, runtime.environments, getWorkspaceSkillsDir()];
  // As spelled, then where it really is, for a path through a link (the
  // temp folder's `/var` on macOS).
  const real = canonicalizeThroughMissing(hostPath);
  const spellings = roots.flatMap((root) => {
    const realRoot = canonicalizeThroughMissing(root);
    return [
      { path: hostPath, root },
      ...(real !== null && realRoot !== null
        ? [{ path: real, root: realRoot }]
        : []),
    ];
  });
  for (const spelling of spellings) {
    const name = hostPathWithin(spelling.root, spelling.path)?.split("/")[1];
    if (name) {
      return AbsolutePathSchema.parse(path.join(spelling.root, name));
    }
  }
  return undefined;
}

type PythonEnvironmentResult = { error: VenvError } | { venv: AbsolutePath };

/**
 * Builds a skill's Python environment. The bash worker replaces it with a
 * request to the main thread, so every environment has one builder and the
 * dedupe below covers the worker's requests and `load_skill`'s alike.
 */
let ensurePythonHere = ensurePythonEnvironmentHere;

export function setPythonEnvironmentBuilder(
  next: (request: {
    chatId: ChatId;
    skillDir: AbsolutePath;
  }) => Promise<PythonEnvironmentResult>,
): void {
  ensurePythonHere = next;
}

/**
 * The skill's Python environment, built first when it is missing or its
 * base Python is gone. A wait cut short by `signal` leaves the build
 * running for the next caller.
 */
export function ensurePythonEnvironment({
  chatId,
  signal,
  skillDir,
}: {
  chatId: ChatId;
  signal?: AbortSignal;
  skillDir: AbsolutePath;
}): Promise<PythonEnvironmentResult> {
  return untilAborted(
    ensurePythonHere({ chatId, skillDir }),
    signal,
    (error) => ({
      error,
    }),
  );
}

/** {@link ensurePythonEnvironment} on the thread that builds. */
export async function ensurePythonEnvironmentHere({
  chatId,
  skillDir,
}: {
  chatId: ChatId;
  skillDir: AbsolutePath;
}): Promise<PythonEnvironmentResult> {
  const target = pythonEnvironmentOf(skillDir);
  if (target === undefined) {
    return {
      error: {
        exitCode: 1,
        output: `${skillDir} has no ${PYTHON_PROJECT_FILE} and ${PYTHON_LOCKFILE} to build a Python environment from.\n`,
      },
    };
  }
  const error = await buildOnce(target, hasUsableVenv, (staging) =>
    buildPythonEnvironment({ chatId, skillDir, staging }),
  );
  return error ? { error } : { venv: target };
}

/**
 * A Node skill's environment: one built copy of the skill with its
 * packages installed beside its scripts, where Node finds them, named by
 * the hash of the skill's files, so each version of the skill gets its own
 * and every chat shares it. Built first when it is missing.
 */
export async function ensureNodeEnvironment({
  chatId,
  signal,
  skillDir,
}: {
  chatId: ChatId;
  signal?: AbortSignal;
  skillDir: AbsolutePath;
}): Promise<{ dir: AbsolutePath } | { error: VenvError }> {
  const target = environmentDir(
    "node",
    await getSkillPackageFingerprint(skillDir),
  );
  const error = await untilAborted(
    buildOnce(
      target,
      (dir) => existsSync(path.join(dir, NODE_MODULES)),
      (staging) => buildNodeEnvironment({ chatId, skillDir, staging }),
    ),
    signal,
    (cancelled) => cancelled,
  );
  return error ? { error } : { dir: target };
}

/**
 * The environment `python` runs in for a skill: the one for the skill whose
 * folder holds `script`, or, where no `.venv` is near `cwd`, the one for the
 * skill loaded last (`loadedSkillDir`). Undefined where neither has one,
 * which leaves `python` to the nearest `.venv` or the managed Python.
 */
export async function skillPythonToRun({
  chatId,
  cwd,
  loadedSkillDir,
  script,
  signal,
}: {
  chatId: ChatId;
  cwd: string;
  /** `$INSTRUMENT_SKILL_DIR`, on the host. */
  loadedSkillDir: string | undefined;
  /** The script on the host, where the command runs one. */
  script: string | undefined;
  signal?: AbortSignal;
}): Promise<PythonEnvironmentResult | undefined> {
  const withEnvironment = (hostPath: string | undefined) => {
    const folder =
      hostPath === undefined ? undefined : trustedSkillFolder(hostPath);
    return folder && pythonEnvironmentOf(folder) ? folder : undefined;
  };
  const folder =
    withEnvironment(script) ??
    (nearestVenv(chatId, cwd) === undefined
      ? withEnvironment(loadedSkillDir)
      : undefined);
  return folder === undefined
    ? undefined
    : ensurePythonEnvironment({ chatId, signal, skillDir: folder });
}

/**
 * The environment's folder on PATH: `bin` on macOS and Linux, `Scripts` on
 * Windows, as uv lays a virtualenv out.
 */
export function environmentBinDir(venv: AbsolutePath): string {
  return path.dirname(venvPython(venv));
}

// Several chats' first use of one skill land together. Reuse the build in
// flight so two never fill one environment at once.
const building = new Map<AbsolutePath, Promise<undefined | VenvError>>();

/**
 * Builds `target` once when `usable` says it is not: into a folder beside it
 * named for this process, renamed into place only when whole, so a reader
 * never sees half an environment and two app instances building the same one
 * keep whichever lands first.
 */
function buildOnce(
  target: AbsolutePath,
  usable: (dir: AbsolutePath) => boolean,
  build: (staging: AbsolutePath) => Promise<undefined | VenvError>,
): Promise<undefined | VenvError> {
  if (usable(target)) {
    return Promise.resolve(undefined);
  }
  const existing = building.get(target);
  if (existing) {
    return existing;
  }
  const staging = AbsolutePathSchema.parse(
    `${path.join(path.dirname(target), `.${path.basename(target)}`)}.building-${process.pid}-${randomUUID()}`,
  );
  const run = (async (): Promise<undefined | VenvError> => {
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await removeAbandoned(path.dirname(target));
      const failure = await build(staging);
      if (failure) {
        return failure;
      }
      await swapInto(staging, target, usable);
      return undefined;
    } catch (error) {
      return {
        exitCode: 1,
        output: error instanceof Error ? error.message : String(error),
      };
    } finally {
      building.delete(target);
      await fs
        .rm(staging, { force: true, recursive: true })
        .catch(() => undefined);
    }
  })();
  building.set(target, run);
  return run;
}

/**
 * Puts a finished build where it belongs. One already there that works was
 * another instance's, and stays; one that does not (its Python gone) is
 * set aside first and removed after.
 */
async function swapInto(
  staging: AbsolutePath,
  target: AbsolutePath,
  usable: (dir: AbsolutePath) => boolean,
) {
  if (existsSync(target)) {
    if (usable(target)) {
      return;
    }
    const stale = `${path.join(path.dirname(target), `.${path.basename(target)}`)}.stale-${process.pid}-${randomUUID()}`;
    await fs.rename(target, stale);
    await fs.rm(stale, { force: true, recursive: true });
  }
  try {
    await fs.rename(staging, target);
  } catch (error) {
    if (!usable(target)) {
      throw error;
    }
  }
}

/** What a build or a swap left behind when its process ended mid-way. */
async function removeAbandoned(dir: string) {
  const entries = await fs.readdir(dir).catch(() => []);
  for (const entry of entries) {
    const pid = /^\..+\.(?:building|stale)-(\d+)-/.exec(entry)?.[1];
    if (pid !== undefined && !processAlive(Number(pid))) {
      await fs
        .rm(path.join(dir, entry), { force: true, recursive: true })
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

/**
 * A relocatable virtualenv from the managed Python with the skill's locked
 * dependencies, bytecode compiled, since no chat may write it later. Run
 * as the chat that asked, held to its reach, with the folder being built
 * opened to it: a lockfile can name a package that builds from source.
 */
async function buildPythonEnvironment({
  chatId,
  skillDir,
  staging,
}: {
  chatId: ChatId;
  skillDir: AbsolutePath;
  staging: AbsolutePath;
}): Promise<undefined | VenvError> {
  const python = await ensureManagedPython();
  if (python) {
    return python;
  }
  const signal = AbortSignal.timeout(BUILD_TIMEOUT_MS);
  const uv = (args: string[], stdin?: string) =>
    runUvCommand({
      args,
      chatId,
      cwd: environmentsDir(),
      lockfilePinned: true,
      signal,
      stdin,
      writable: [staging],
    });

  const venv = await uv([
    "venv",
    "--relocatable",
    "--python",
    MANAGED_PYTHON_VERSION,
    staging,
  ]);
  if (venv.exitCode !== 0) {
    return { exitCode: venv.exitCode, output: venv.combined };
  }
  const requirements = await uv([
    "export",
    "--locked",
    "--no-dev",
    "--no-emit-project",
    "--no-hashes",
    "--project",
    skillDir,
  ]);
  if (requirements.exitCode !== 0) {
    return { exitCode: requirements.exitCode, output: requirements.combined };
  }
  if (!hasRequirements(requirements.stdout)) {
    return undefined;
  }
  const installed = await uv(
    [
      "pip",
      "install",
      "--compile-bytecode",
      "--python",
      venvPython(staging),
      "--requirement",
      "-",
    ],
    requirements.stdout,
  );
  return installed.exitCode === 0
    ? undefined
    : { exitCode: installed.exitCode, output: installed.combined };
}

function hasRequirements(requirements: string) {
  return requirements.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

/**
 * A copy of the skill, less what only its development needs, with its
 * production packages installed in it. Held to the asking chat's reach,
 * with the folder being built opened to it.
 */
async function buildNodeEnvironment({
  chatId,
  skillDir,
  staging,
}: {
  chatId: ChatId;
  skillDir: AbsolutePath;
  staging: AbsolutePath;
}): Promise<undefined | VenvError> {
  await copySkillFiles(skillDir, staging);
  const installed = await runPnpmCommand({
    args: ["install", "--prod"],
    chatId,
    cwd: staging,
    signal: AbortSignal.timeout(BUILD_TIMEOUT_MS),
    writable: [staging],
  });
  if (installed.exitCode !== 0) {
    return {
      exitCode: installed.exitCode,
      output: installed.stdout + installed.stderr,
    };
  }
  // A skill whose only dependencies are for its development installs none,
  // and is still built.
  await fs.mkdir(path.join(staging, NODE_MODULES), { recursive: true });
  return undefined;
}

/**
 * The skill's files: what its own `.gitignore` leaves out stays out (it
 * speaks for what the skill's folder holds besides itself), and so does
 * what only its development needs (`SKILL_COPY_IGNORE`).
 */
async function copySkillFiles(from: AbsolutePath, to: AbsolutePath) {
  const ignore = (await getIgnore(from)).add(SKILL_COPY_IGNORE);
  await fs.cp(from, to, {
    dereference: true,
    filter: (source) => {
      const relativePath = normalizePath(path.relative(from, source));
      // A directory-only rule (`build/`) matches only with the trailing
      // slash, and the filter is not told whether `source` is a directory.
      return (
        relativePath === "" ||
        (!ignore.ignores(relativePath) && !ignore.ignores(`${relativePath}/`))
      );
    },
    recursive: true,
  });
}

/**
 * Waits for `work` unless `signal` ends the wait first, which leaves the
 * work running for whoever else waits on it.
 */
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  cancelled: (error: VenvError) => T,
): Promise<T> {
  if (signal === undefined) {
    return work;
  }
  const error = {
    exitCode: 1,
    output: "Setting up the skill's packages was cancelled.\n",
  };
  if (signal.aborted) {
    return Promise.resolve(cancelled(error));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      resolve(cancelled(error));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });
}
