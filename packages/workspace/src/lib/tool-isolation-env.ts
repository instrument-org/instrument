import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runtimeLayout } from "./runtime-dir";

// Depends on nothing of the workspace's but the runtime layout, which
// depends on nothing either, so the sandbox bake-off probe runs the same
// isolation the app does.

/**
 * The environment that pins pnpm, npm and node-gyp to the chats' caches and
 * config in `runtimeDir`. The person's `~/.npmrc` is read, so a registry, a
 * proxy and a sign-in to a private registry work in a chat as they do in
 * their terminal; the sandbox keeps it from changes. Their
 * `~/.config/pnpm/rc`, `PNPM_HOME`, global store and caches are never read
 * or written. Each is pinned by name rather than by moving the folders a
 * tool looks in, since every program on the PATH gets this environment and
 * one that keeps its own settings under `~/.config` would have found an
 * empty folder instead of the person's. The global config file is the app's
 * own and empty. pnpm's settings for every install the agent makes,
 * wherever it makes it, are the `pnpm_config_*` variables here, which a
 * project's own `pnpm-workspace.yaml` can still change for that project.
 */
export function nodeToolsEnvFor(
  runtimeDir: string,
  home = os.homedir(),
): Record<string, string> {
  const { caches, config } = runtimeLayout(runtimeDir);
  return nodeToolsEnvIn(caches, config, path.join(home, ".npmrc"));
}

/**
 * {@link nodeToolsEnvFor} for the app's build of a skill it ships: the same
 * settings, with the store, caches and config in the build folders, which no
 * chat reaches, so no chat's install or setting reaches what every chat
 * then runs. Its npm config is the app's own and empty, never `~/.npmrc`.
 */
export function nodeBuildEnvFor(runtimeDir: string): Record<string, string> {
  const { buildCaches, buildConfig } = runtimeLayout(runtimeDir);
  return nodeToolsEnvIn(buildCaches, buildConfig);
}

/**
 * {@link nodeToolsEnvFor} for the pnpm install step the app runs outside the
 * sandbox (`pnpm-outside.ts`): the same settings, with the store, caches,
 * config and temp folder in the install folders, which no chat changes, and
 * nothing that runs a package's code or another pnpm. Its npm config is the
 * app's own and empty, never `~/.npmrc`, since a registry or a pnpmfile set
 * there would steer an install no sandbox holds. Install scripts and
 * pnpmfiles are off, a `packageManager` or `devEngines` naming another pnpm
 * is ignored rather than downloaded and run, and a dependency of a package
 * comes from the registry alone.
 */
export function nodeInstallEnvFor(runtimeDir: string): Record<string, string> {
  const { installCaches, installConfig } = runtimeLayout(runtimeDir);
  const temp = path.join(installCaches, "tmp");
  mkdirSync(temp, { recursive: true });
  return {
    ...nodeToolsEnvIn(installCaches, installConfig),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    // pnpm's global config, auth file and data folders, wherever it looks.
    XDG_CACHE_HOME: installCaches,
    XDG_CONFIG_HOME: installConfig,
    XDG_DATA_HOME: installCaches,
    XDG_STATE_HOME: installCaches,
    pnpm_config_block_exotic_subdeps: "true",
    pnpm_config_ignore_pnpmfile: "true",
    pnpm_config_ignore_scripts: "true",
    pnpm_config_pm_on_fail: "ignore",
  };
}

function nodeToolsEnvIn(
  caches: string,
  config: string,
  personNpmrc?: string,
): Record<string, string> {
  const userConfig = personNpmrc ?? path.join(config, "npmrc");
  const globalConfig = path.join(config, "npmrc-global");
  const own = personNpmrc ? [globalConfig] : [userConfig, globalConfig];
  if (!own.every((file) => existsSync(file))) {
    mkdirSync(config, { recursive: true });
    for (const file of own) {
      if (!existsSync(file)) {
        writeFileSync(file, "");
      }
    }
  }
  return {
    PNPM_HOME: path.join(caches, "pnpm-home"),
    // npm, node-gyp and anything else that reads npm's own settings.
    npm_config_cache: path.join(caches, "npm"),
    npm_config_devdir: path.join(caches, "node-gyp"),
    npm_config_globalconfig: globalConfig,
    npm_config_userconfig: userConfig,
    // pnpm 11 reads its settings from `pnpm_config_*` alone.
    pnpm_config_cache_dir: path.join(caches, "pnpm"),
    // A chat folder installed against an earlier store is reinstalled
    // against this one without asking, since nobody answers a prompt here.
    pnpm_config_confirm_modules_purge: "false",
    // What `pnpx` fetched stays for 180 days, so it is warm in every chat.
    pnpm_config_dlx_cache_max_age: String(180 * 24 * 60),
    pnpm_config_global_bin_dir: path.join(caches, "pnpm-global-bin"),
    pnpm_config_global_dir: path.join(caches, "pnpm-global"),
    pnpm_config_globalconfig: globalConfig,
    // `pnpm init` otherwise pins the project to the newest pnpm on the
    // registry (`devEngines.packageManager` with `onFail: download`), and
    // every later pnpm there downloads and runs that one instead of the
    // app's.
    pnpm_config_init_package_manager: "false",
    // A release younger than a week is not installed, in minutes.
    pnpm_config_minimum_release_age: String(RELEASE_AGE_DAYS * 24 * 60),
    pnpm_config_npmrc_auth_file: userConfig,
    pnpm_config_state_dir: path.join(caches, "pnpm-state"),
    pnpm_config_store_dir: path.join(caches, "pnpm-store"),
    // A dependency's install script nobody allowed is skipped with a warning
    // rather than failing the install, so a package the agent adds cannot
    // dead-end it; the bash tool says how to allow one
    // (`ignoredBuildsNote`).
    pnpm_config_strict_dep_builds: "false",
    pnpm_config_update_notifier: "false",
    pnpm_config_userconfig: userConfig,
    // pnpm 11 has every `pnpm run` and `pnpm exec` check the install first
    // and start one of its own when it looks stale, which races the agent's
    // own installs against the shared store and deadlocks. It installs when
    // the agent installs.
    pnpm_config_verify_deps_before_run: "false",
  };
}

/**
 * How many days old a package must be before an install takes it, as
 * pnpm's `minimumReleaseAge` holds npm packages.
 */
export const RELEASE_AGE_DAYS = 7;

/**
 * The environment that pins uv (and anything that runs the real pip) to
 * `runtimeDir`: its cache and the tools it puts on a PATH in the caches, the
 * Pythons it installs in their own folder, with no config of the person's
 * read (`uv.toml` in their home or a parent folder, `pip.conf`), and none of
 * their Pythons used. A release younger than a week is not installed, the
 * gate pnpm holds npm packages to.
 */
export function uvToolsEnvFor(
  runtimeDir: string,
  now = new Date(),
): Record<string, string> {
  const { caches, python } = runtimeLayout(runtimeDir);
  return uvToolsEnvIn(caches, python, now);
}

/**
 * {@link uvToolsEnvFor} for what the app builds or runs from uv's cache that
 * every chat then runs (a shipped skill's environment, the managed Python,
 * a connected app's local server): the same settings, with the cache and
 * tools in the build folders, which no chat reaches.
 */
export function uvBuildEnvFor(
  runtimeDir: string,
  now = new Date(),
): Record<string, string> {
  const { buildCaches, python } = runtimeLayout(runtimeDir);
  return {
    ...uvToolsEnvIn(buildCaches, python, now),
    MPLCONFIGDIR: path.join(buildCaches, "matplotlib"),
    XDG_CACHE_HOME: buildCaches,
  };
}

/**
 * Where a chat's programs keep the caches they make for themselves (models,
 * font caches), so a download lands once and outlives the chat. On macOS and
 * Linux that is the person's own `~/.cache`, which the app-files place opens
 * (`places.ts`): Hugging Face and Whisper find it with nothing set, and
 * matplotlib and rembg, whose own folders (`~/.matplotlib`, `~/.u2net`) sit
 * in the home folder a program cannot change, are pointed into it. Windows
 * opens no cache folder of the person's, and a program held by the sandbox
 * there gets a `LOCALAPPDATA` that is gone when it exits, so every one of
 * them is pointed at the runtime folder's caches instead.
 */
export function modelCachesEnvFor(
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
): Record<string, string> {
  if (platform !== "win32") {
    const caches = path.join(home, ".cache");
    return {
      MPLCONFIGDIR: path.join(caches, "matplotlib"),
      U2NET_HOME: path.join(caches, "u2net"),
    };
  }
  const { caches } = runtimeLayout(runtimeDir);
  return {
    HF_HOME: path.join(caches, "huggingface"),
    MPLCONFIGDIR: path.join(caches, "matplotlib"),
    U2NET_HOME: path.join(caches, "u2net"),
    XDG_CACHE_HOME: caches,
  };
}

function uvToolsEnvIn(
  caches: string,
  python: string,
  now: Date,
): Record<string, string> {
  return {
    PIP_CONFIG_FILE: os.devNull,
    // Bytecode for a module imported from the person's folders is kept here
    // rather than in a `__pycache__` beside it, where it would sync.
    PYTHONPYCACHEPREFIX: path.join(caches, "pycache"),
    UV_CACHE_DIR: path.join(caches, "uv"),
    UV_EXCLUDE_NEWER: new Date(
      now.getTime() - RELEASE_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    UV_NO_CONFIG: "1",
    // uv's own Pythons alone, so neither `uv venv` nor anything it runs
    // picks up a python3 the person has earlier on their PATH.
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_PYTHON_INSTALL_DIR: python,
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_TOOL_BIN_DIR: path.join(caches, "uv-tools", "bin"),
    UV_TOOL_DIR: path.join(caches, "uv-tools"),
  };
}
