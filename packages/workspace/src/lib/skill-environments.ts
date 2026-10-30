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
import {
  MANAGED_PYTHON_VERSION,
  nearestVenv,
  venvPython,
  venvSitePackages,
} from "./uv";
import { hasUsableVenv, type VenvError } from "./venv";
import { getWorkspaceConfig } from "./workspace-config";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Part of every environment's name, so one built a way this build no longer
 * builds is never taken for one it would.
 */
const ENVIRONMENT_FORMAT = 2;

/**
 * What the name of an environment built for a skill the app ships starts
 * with. One built for a skill any chat can change (the workspace's own) has
 * none, so it is never taken for a shipped skill's, whatever the two lock,
 * and neither is a folder named some other way.
 */
const SHIPPED_ENVIRONMENT_PREFIX = "shipped-";

/** Long enough for a cold cache to fetch a skill's wheels on a slow connection. */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

const PYTHON_PROJECT_FILE = "pyproject.toml";
const PYTHON_LOCKFILE = "uv.lock";
const NODE_MODULES = "node_modules";

/** The site-packages folder the layer's `sitecustomize` adds. */
const EXTRA_SITE_PACKAGES = "INSTRUMENT_EXTRA_SITE_PACKAGES";
const SITE_LAYER_FILE = "sitecustomize.py";

/**
 * Lays a second environment's packages behind the ones Python runs with.
 * `site` imports `sitecustomize` once it has put the interpreter's own
 * site-packages on `sys.path`, so `site.addsitedir` appends the folder after
 * them and runs its `.pth` files, where `PYTHONPATH` would put it ahead of
 * them. It takes its own folder back off `sys.path`, then runs the
 * `sitecustomize` it stands in front of, where the interpreter or a package
 * has one (a Python on this computer may, though none the app builds does).
 * A Python of another version, which a program the script starts may run,
 * adds nothing, and a folder already on the path is not added again.
 */
const SITE_LAYER_SOURCE = `import importlib.machinery
import importlib.util
import os
import site
import sys


def _layer():
    def key(entry):
        return os.path.normcase(os.path.realpath(entry))

    here = key(os.path.dirname(__file__))
    sys.path[:] = [entry for entry in sys.path if not entry or key(entry) != here]
    extra = os.environ.get("${EXTRA_SITE_PACKAGES}", "")
    if (
        "%d.%d" % sys.version_info[:2] == "${MANAGED_PYTHON_VERSION}"
        and os.path.isdir(extra)
        and key(extra) not in [key(entry) for entry in sys.path if entry]
    ):
        site.addsitedir(extra)
    spec = importlib.machinery.PathFinder.find_spec("sitecustomize", sys.path)
    if spec is not None and spec.loader is not None:
        module = importlib.util.module_from_spec(spec)
        sys.modules["sitecustomize"] = module
        spec.loader.exec_module(module)


_layer()
del _layer
`;

function environmentsDir(): AbsolutePath {
  return AbsolutePathSchema.parse(
    runtimeLayout(getWorkspaceConfig().runtimeDir).environments,
  );
}

function environmentDir(shipped: boolean, ...parts: string[]): AbsolutePath {
  const hash = createHash("sha256");
  for (const part of [String(ENVIRONMENT_FORMAT), ...parts]) {
    hash.update(part);
    hash.update("\0");
  }
  const name = hash.digest("hex").slice(0, 16);
  return AbsolutePathSchema.parse(
    path.join(
      environmentsDir(),
      shipped ? `${SHIPPED_ENVIRONMENT_PREFIX}${name}` : name,
    ),
  );
}

/**
 * The Python environment for a skill's locked dependencies, in the runtime
 * folder's `environments/`, named by the hash of its `uv.lock` and the
 * managed Python's version, so every skill locking the same set shares one,
 * the skills the app ships apart from the workspace's own.
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
    // oxlint-disable-next-line studio/no-sync-content-read -- TODO(async-workspace-files): load_skill reaches this on the main thread, and a workspace skill's uv.lock is in the synced Skills/ folder.
    lockfile = readFileSync(path.join(skillDir, PYTHON_LOCKFILE), "utf8");
  } catch {
    return undefined;
  }
  return environmentDir(
    shippedSkill(skillDir),
    "python",
    MANAGED_PYTHON_VERSION,
    lockfile,
  );
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
  for (const root of [
    runtime.skills,
    runtime.environments,
    getWorkspaceSkillsDir(),
  ]) {
    const folder = folderWithin(root, hostPath);
    if (folder) {
      return folder;
    }
  }
  return undefined;
}

/**
 * Whether the skill in `skillDir` is one the app ships, from the runtime
 * folder's `skills/` or built from one there, which no chat can change. Its
 * environments are built from the build folders alone; the workspace's own
 * skills, which any chat can change, are built as the chat's own installs
 * are, into environments of their own.
 */
function shippedSkill(skillDir: string): boolean {
  const runtime = runtimeLayout(getWorkspaceConfig().runtimeDir);
  if (folderWithin(runtime.skills, skillDir)) {
    return true;
  }
  const built = folderWithin(runtime.environments, skillDir);
  return (
    built !== undefined &&
    path.basename(built).startsWith(SHIPPED_ENVIRONMENT_PREFIX)
  );
}

/**
 * The folder directly in `root` that holds `hostPath`, compared as spelled,
 * then where each really is, for a path through a link (the temp folder's
 * `/var` on macOS).
 */
function folderWithin(
  root: string,
  hostPath: string,
): AbsolutePath | undefined {
  const real = canonicalizeThroughMissing(hostPath);
  const realRoot = canonicalizeThroughMissing(root);
  const spellings = [
    { path: hostPath, root },
    ...(real !== null && realRoot !== null
      ? [{ path: real, root: realRoot }]
      : []),
  ];
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

/**
 * {@link ensurePythonEnvironment} on the thread that builds, with the
 * folder that layers an environment under another
 * ({@link pythonLayerEnv}).
 */
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
  const error =
    (await buildOnce(target, hasUsableVenv, (staging) =>
      buildPythonEnvironment({
        chatId,
        shipped: shippedSkill(skillDir),
        skillDir,
        staging,
      }),
    )) ??
    (await buildOnce(
      siteLayerDir(),
      (dir) => existsSync(path.join(dir, SITE_LAYER_FILE)),
      async (staging) => {
        await fs.mkdir(staging, { recursive: true });
        await fs.writeFile(
          path.join(staging, SITE_LAYER_FILE),
          SITE_LAYER_SOURCE,
        );
        return undefined;
      },
    ));
  return error ? { error } : { venv: target };
}

/**
 * The folder holding the layer's `sitecustomize`, in `environments/` beside
 * the environments it layers, named by its source.
 */
function siteLayerDir(): AbsolutePath {
  return environmentDir(true, "site", SITE_LAYER_SOURCE);
}

/**
 * The variables that put `layer`'s site-packages after the interpreter's
 * own, in the Python started with them and every Python that one starts:
 * the folder holding the layer's `sitecustomize` ahead of what `PYTHONPATH`
 * was, and the folder it adds.
 */
export function pythonLayerEnv(
  layer: AbsolutePath,
  pythonPath: string | undefined,
): Record<string, string> {
  return {
    [EXTRA_SITE_PACKAGES]: venvSitePackages(layer),
    PYTHONPATH: [siteLayerDir(), pythonPath]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

/**
 * A Node skill's environment: one built copy of the skill with its
 * packages installed beside its scripts, where Node finds them, named by
 * the hash of the skill's files, so each version of the skill gets its own
 * and every chat shares it, the skills the app ships apart from the
 * workspace's own. Built first when it is missing.
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
  const shipped = shippedSkill(skillDir);
  const target = environmentDir(
    shipped,
    "node",
    await getSkillPackageFingerprint(skillDir),
  );
  const error = await untilAborted(
    buildOnce(
      target,
      (dir) => existsSync(path.join(dir, NODE_MODULES)),
      (staging) => buildNodeEnvironment({ chatId, shipped, skillDir, staging }),
    ),
    signal,
    (cancelled) => cancelled,
  );
  return error ? { error } : { dir: target };
}

/**
 * The skill environments `python` runs with, layered so the skill's packages
 * and what `pip install` put in the `.venv` nearest `cwd` are both found:
 *
 * - A script in a skill's folder runs in that skill's environment (`venv`),
 *   with the `.venv` behind it (`layer`), so the skill's own versions win.
 * - Anything else runs in the `.venv`, which the caller finds, with the
 *   environment of the skill loaded last (`loadedSkillDir`) behind it, so
 *   what the agent installed wins; with no `.venv` near, in that skill's
 *   environment itself.
 *
 * It names neither where no skill with an environment is involved, which
 * leaves `python` to the nearest `.venv` or the managed Python.
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
}): Promise<
  | { error: VenvError }
  | {
      /** The environment whose site-packages go behind the interpreter's. */
      layer?: AbsolutePath;
      /** The skill environment `python` runs in, where it runs in one. */
      venv?: AbsolutePath;
    }
> {
  const withEnvironment = (hostPath: string | undefined) => {
    const folder =
      hostPath === undefined ? undefined : trustedSkillFolder(hostPath);
    return folder && pythonEnvironmentOf(folder) ? folder : undefined;
  };
  const near = nearestVenv(chatId, cwd);
  const scriptSkill = withEnvironment(script);
  if (scriptSkill !== undefined) {
    const built = await ensurePythonEnvironment({
      chatId,
      signal,
      skillDir: scriptSkill,
    });
    return "error" in built || near === undefined
      ? built
      : { layer: near, venv: built.venv };
  }
  const loaded = withEnvironment(loadedSkillDir);
  if (loaded === undefined) {
    return {};
  }
  const built = await ensurePythonEnvironment({
    chatId,
    signal,
    skillDir: loaded,
  });
  if (near === undefined) {
    return built;
  }
  // The agent's own code runs in its `.venv` either way; a skill
  // environment that cannot be built only leaves its packages out.
  return "error" in built ? {} : { layer: built.venv };
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
 * dependencies, each checked against the hash its lockfile records, and
 * bytecode compiled, since no chat may write it later. Run as the chat
 * that asked, held to its reach, with the folder being built opened to it:
 * a lockfile can name a package that builds from source. A skill the app
 * ships is built from the build folders' cache, opened to the build alone;
 * the workspace's own, from the chats' cache, as the chat's own installs
 * are.
 */
async function buildPythonEnvironment({
  chatId,
  shipped,
  skillDir,
  staging,
}: {
  chatId: ChatId;
  shipped: boolean;
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
      buildFolders: shipped,
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
      "--require-hashes",
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
 * production packages installed in it as its lockfile has them. Held to
 * the asking chat's reach, with the folder being built opened to it. A
 * skill the app ships is built from the build folders' store and config,
 * opened to the build alone; the workspace's own, from the chats', as the
 * chat's own installs are.
 */
async function buildNodeEnvironment({
  chatId,
  shipped,
  skillDir,
  staging,
}: {
  chatId: ChatId;
  shipped: boolean;
  skillDir: AbsolutePath;
  staging: AbsolutePath;
}): Promise<undefined | VenvError> {
  await copySkillFiles(skillDir, staging);
  const installed = await runPnpmCommand({
    args: ["install", "--prod", "--frozen-lockfile"],
    buildFolders: shipped,
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
