import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Depends on nothing of the workspace's, so the sandbox bake-off probe runs
// the same isolation the app does.

/**
 * The environment that pins pnpm, npm and node-gyp to `dir` and its own
 * config, whatever the person's setup holds: their `~/.npmrc` (a registry,
 * `ignore-scripts`), `~/.config/pnpm/rc`, `PNPM_HOME`, global store and
 * caches are never read or written. The config files are the app's own and
 * empty; what a chat's install needs comes from its own
 * `pnpm-workspace.yaml`.
 */
export function nodeToolsEnvFor(dir: string): Record<string, string> {
  const userConfig = path.join(dir, "npmrc");
  const globalConfig = path.join(dir, "npmrc-global");
  if (!existsSync(userConfig) || !existsSync(globalConfig)) {
    mkdirSync(dir, { recursive: true });
    for (const file of [userConfig, globalConfig]) {
      if (!existsSync(file)) {
        writeFileSync(file, "");
      }
    }
  }
  return {
    PNPM_HOME: path.join(dir, "pnpm-home"),
    // npm, node-gyp and anything else that reads npm's own settings.
    npm_config_cache: path.join(dir, "npm-cache"),
    npm_config_devdir: path.join(dir, "node-gyp"),
    npm_config_globalconfig: globalConfig,
    npm_config_userconfig: userConfig,
    // pnpm 11 reads its settings from `pnpm_config_*` alone.
    pnpm_config_cache_dir: path.join(dir, "pnpm-cache"),
    // A chat folder installed against an earlier store is reinstalled
    // against this one without asking, since nobody answers a prompt here.
    pnpm_config_confirm_modules_purge: "false",
    pnpm_config_global_bin_dir: path.join(dir, "global-bin"),
    pnpm_config_global_dir: path.join(dir, "global"),
    pnpm_config_globalconfig: globalConfig,
    pnpm_config_npmrc_auth_file: userConfig,
    pnpm_config_state_dir: path.join(dir, "pnpm-state"),
    pnpm_config_store_dir: path.join(dir, "pnpm-store"),
    pnpm_config_userconfig: userConfig,
  };
}

/** Where uv keeps the Pythons it installs, in `uvDataDir`. */
export function uvPythonInstallDir(uvDataDir: string): string {
  return path.join(uvDataDir, "python");
}

/**
 * Where the app installs the packages every chat's `python` starts with
 * (`python-base.ts`), in `uvDataDir`.
 */
export function uvPythonBaseDir(uvDataDir: string): string {
  return path.join(uvDataDir, "python-base");
}

/**
 * How many days old a package must be before an install takes it, as
 * pnpm's `minimumReleaseAge` holds npm packages.
 */
export const RELEASE_AGE_DAYS = 7;

/**
 * The environment that pins uv (and anything that runs the real pip) to
 * `uvDataDir`: its cache, the Pythons it installs and the tools it puts on a
 * PATH, with no config of the person's read (`uv.toml` in their home or a
 * parent folder, `pip.conf`), and none of their Pythons used. A release
 * younger than a week is not
 * installed, the gate a chat's `pnpm-workspace.yaml` holds npm packages to.
 */
export function uvToolsEnvFor(
  uvDataDir: string,
  now = new Date(),
): Record<string, string> {
  return {
    // matplotlib keeps its font cache in ~/.matplotlib on macOS, which the
    // sandbox keeps from changes, so without its own folder every chart
    // rebuilt the cache (about ten seconds).
    MPLCONFIGDIR: path.join(uvDataDir, "matplotlib"),
    PIP_CONFIG_FILE: os.devNull,
    UV_CACHE_DIR: path.join(uvDataDir, "cache"),
    UV_EXCLUDE_NEWER: new Date(
      now.getTime() - RELEASE_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    UV_NO_CONFIG: "1",
    // uv's own Pythons alone, so neither `uv venv` nor anything it runs
    // picks up a python3 the person has earlier on their PATH.
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_PYTHON_INSTALL_DIR: uvPythonInstallDir(uvDataDir),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_TOOL_BIN_DIR: path.join(uvDataDir, "tools", "bin"),
    UV_TOOL_DIR: path.join(uvDataDir, "tools"),
    XDG_CACHE_HOME: path.join(uvDataDir, "cache-home"),
  };
}
