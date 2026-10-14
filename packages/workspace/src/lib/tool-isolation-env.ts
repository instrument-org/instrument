import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runtimeLayout } from "./runtime-dir";

// Depends on nothing of the workspace's but the runtime layout, which
// depends on nothing either, so the sandbox bake-off probe runs the same
// isolation the app does.

/**
 * The environment that pins pnpm, npm and node-gyp to the caches and config
 * in `runtimeDir`, whatever the person's setup holds: their `~/.npmrc` (a
 * registry, `ignore-scripts`), `~/.config/pnpm/rc`, `PNPM_HOME`, global
 * store and caches are never read or written. The config files are the
 * app's own and empty; what a chat's install needs comes from its own
 * `pnpm-workspace.yaml`.
 */
export function nodeToolsEnvFor(runtimeDir: string): Record<string, string> {
  const { caches, config } = runtimeLayout(runtimeDir);
  const userConfig = path.join(config, "npmrc");
  const globalConfig = path.join(config, "npmrc-global");
  if (!existsSync(userConfig) || !existsSync(globalConfig)) {
    mkdirSync(config, { recursive: true });
    for (const file of [userConfig, globalConfig]) {
      if (!existsSync(file)) {
        writeFileSync(file, "");
      }
    }
  }
  return {
    PNPM_HOME: path.join(caches, "pnpm-home"),
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: path.join(caches, "data"),
    XDG_STATE_HOME: path.join(caches, "state"),
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
    pnpm_config_global_bin_dir: path.join(caches, "pnpm-global-bin"),
    pnpm_config_global_dir: path.join(caches, "pnpm-global"),
    pnpm_config_globalconfig: globalConfig,
    pnpm_config_npmrc_auth_file: userConfig,
    pnpm_config_state_dir: path.join(caches, "pnpm-state"),
    pnpm_config_store_dir: path.join(caches, "pnpm-store"),
    pnpm_config_userconfig: userConfig,
  };
}

/** How many days old a package must be before an install takes it. */
const RELEASE_AGE_DAYS = 7;

/**
 * The environment that pins uv (and anything that runs the real pip) to
 * `runtimeDir`: its cache and the tools it puts on a PATH in the caches, the
 * Pythons it installs in their own folder, with no config of the person's
 * read (`uv.toml` in their home or a parent folder, `pip.conf`), and none of
 * their Pythons used. A release younger than a week is not installed, the
 * gate a chat's `pnpm-workspace.yaml` holds npm packages to.
 */
export function uvToolsEnvFor(
  runtimeDir: string,
  now = new Date(),
): Record<string, string> {
  const { caches, python } = runtimeLayout(runtimeDir);
  return {
    // matplotlib keeps its font cache in ~/.matplotlib on macOS, which the
    // sandbox keeps from changes, so without its own folder every chart
    // rebuilt the cache (about ten seconds).
    MPLCONFIGDIR: path.join(caches, "matplotlib"),
    PIP_CONFIG_FILE: os.devNull,
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
    XDG_CACHE_HOME: caches,
  };
}
