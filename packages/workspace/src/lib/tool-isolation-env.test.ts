import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runtimeLayout } from "./runtime-dir";
import {
  modelCachesEnvFor,
  nodeBuildEnvFor,
  nodeInstallEnvFor,
  nodeToolsEnvFor,
  uvBuildEnvFor,
  uvToolsEnvFor,
} from "./tool-isolation-env";

const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "tool-isolation-env-"));
// A home folder in the runtime folder, so its paths read as the rest do.
const home = path.join(runtimeDir, "home");

/** Each path in the runtime folder spelled from it, so the layout reads at a glance. */
function inRuntime(env: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [
      name,
      value === os.devNull
        ? "<devNull>"
        : value.startsWith(runtimeDir)
          ? `<runtime>/${path.relative(runtimeDir, value).replaceAll("\\", "/")}`
          : value,
    ]),
  );
}

describe("the runtime folder", () => {
  it("holds uv's Pythons apart from its cache and tools", () => {
    expect(inRuntime(uvToolsEnvFor(runtimeDir, new Date("2026-10-13Z"))))
      .toMatchInlineSnapshot(`
        {
          "PIP_CONFIG_FILE": "<devNull>",
          "PYTHONPYCACHEPREFIX": "<runtime>/caches/pycache",
          "UV_CACHE_DIR": "<runtime>/caches/uv",
          "UV_EXCLUDE_NEWER": "2026-10-06T00:00:00.000Z",
          "UV_NO_CONFIG": "1",
          "UV_PYTHON_DOWNLOADS": "automatic",
          "UV_PYTHON_INSTALL_DIR": "<runtime>/python",
          "UV_PYTHON_PREFERENCE": "only-managed",
          "UV_TOOL_BIN_DIR": "<runtime>/caches/uv-tools/bin",
          "UV_TOOL_DIR": "<runtime>/caches/uv-tools",
        }
      `);
  });

  // Snapshotted whole so pnpm's safety settings stay in view: weakening the
  // release-age gate or the build policy has to show up as a diff here.
  it("holds the node tools' caches, the person's npmrc, and pnpm's settings", () => {
    expect(inRuntime(nodeToolsEnvFor(runtimeDir, home))).toMatchInlineSnapshot(`
      {
        "PNPM_HOME": "<runtime>/caches/pnpm-home",
        "npm_config_cache": "<runtime>/caches/npm",
        "npm_config_devdir": "<runtime>/caches/node-gyp",
        "npm_config_globalconfig": "<runtime>/config/npmrc-global",
        "npm_config_userconfig": "<runtime>/home/.npmrc",
        "pnpm_config_cache_dir": "<runtime>/caches/pnpm",
        "pnpm_config_confirm_modules_purge": "false",
        "pnpm_config_dlx_cache_max_age": "259200",
        "pnpm_config_global_bin_dir": "<runtime>/caches/pnpm-global-bin",
        "pnpm_config_global_dir": "<runtime>/caches/pnpm-global",
        "pnpm_config_globalconfig": "<runtime>/config/npmrc-global",
        "pnpm_config_init_package_manager": "false",
        "pnpm_config_minimum_release_age": "10080",
        "pnpm_config_npmrc_auth_file": "<runtime>/home/.npmrc",
        "pnpm_config_state_dir": "<runtime>/caches/pnpm-state",
        "pnpm_config_store_dir": "<runtime>/caches/pnpm-store",
        "pnpm_config_strict_dep_builds": "false",
        "pnpm_config_update_notifier": "false",
        "pnpm_config_userconfig": "<runtime>/home/.npmrc",
        "pnpm_config_verify_deps_before_run": "false",
      }
    `);
    // The person's `~/.npmrc` is read where it is; the app makes only the
    // empty global config.
    expect(readdirSync(runtimeLayout(runtimeDir).config).toSorted()).toEqual([
      "npmrc-global",
    ]);
  });

  it("keeps model caches in the person's ~/.cache, and on Windows in the runtime folder", () => {
    expect(
      Object.fromEntries(
        (["darwin", "linux", "win32"] as const).map((platform) => [
          platform,
          inRuntime(modelCachesEnvFor(runtimeDir, platform, home)),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "darwin": {
          "MPLCONFIGDIR": "<runtime>/home/.cache/matplotlib",
          "U2NET_HOME": "<runtime>/home/.cache/u2net",
        },
        "linux": {
          "MPLCONFIGDIR": "<runtime>/home/.cache/matplotlib",
          "U2NET_HOME": "<runtime>/home/.cache/u2net",
        },
        "win32": {
          "HF_HOME": "<runtime>/caches/huggingface",
          "MPLCONFIGDIR": "<runtime>/caches/matplotlib",
          "U2NET_HOME": "<runtime>/caches/u2net",
          "XDG_CACHE_HOME": "<runtime>/caches",
        },
      }
    `);
  });

  // The install step runs outside the sandbox, so it reads nothing a chat
  // writes and runs no package's code.
  it("points the install step at the install folders, with scripts off", () => {
    const env = nodeInstallEnvFor(runtimeDir);
    const { caches, config } = runtimeLayout(runtimeDir);
    expect(
      Object.values(env).filter((value) =>
        [caches, config].some((chats) => value.startsWith(chats)),
      ),
    ).toEqual([]);
    expect(inRuntime(env)).toMatchInlineSnapshot(`
      {
        "PNPM_HOME": "<runtime>/install/caches/pnpm-home",
        "TEMP": "<runtime>/install/caches/tmp",
        "TMP": "<runtime>/install/caches/tmp",
        "TMPDIR": "<runtime>/install/caches/tmp",
        "XDG_CACHE_HOME": "<runtime>/install/caches",
        "XDG_CONFIG_HOME": "<runtime>/install/config",
        "XDG_DATA_HOME": "<runtime>/install/caches",
        "XDG_STATE_HOME": "<runtime>/install/caches",
        "npm_config_cache": "<runtime>/install/caches/npm",
        "npm_config_devdir": "<runtime>/install/caches/node-gyp",
        "npm_config_globalconfig": "<runtime>/install/config/npmrc-global",
        "npm_config_userconfig": "<runtime>/install/config/npmrc",
        "pnpm_config_block_exotic_subdeps": "true",
        "pnpm_config_cache_dir": "<runtime>/install/caches/pnpm",
        "pnpm_config_confirm_modules_purge": "false",
        "pnpm_config_dlx_cache_max_age": "259200",
        "pnpm_config_global_bin_dir": "<runtime>/install/caches/pnpm-global-bin",
        "pnpm_config_global_dir": "<runtime>/install/caches/pnpm-global",
        "pnpm_config_globalconfig": "<runtime>/install/config/npmrc-global",
        "pnpm_config_ignore_pnpmfile": "true",
        "pnpm_config_ignore_scripts": "true",
        "pnpm_config_init_package_manager": "false",
        "pnpm_config_minimum_release_age": "10080",
        "pnpm_config_npmrc_auth_file": "<runtime>/install/config/npmrc",
        "pnpm_config_pm_on_fail": "ignore",
        "pnpm_config_state_dir": "<runtime>/install/caches/pnpm-state",
        "pnpm_config_store_dir": "<runtime>/install/caches/pnpm-store",
        "pnpm_config_strict_dep_builds": "false",
        "pnpm_config_update_notifier": "false",
        "pnpm_config_userconfig": "<runtime>/install/config/npmrc",
        "pnpm_config_verify_deps_before_run": "false",
      }
    `);
  });

  // What the app builds and every chat runs comes from folders no chat
  // writes: nothing of the chats' caches or config is named here.
  it("points the app's builds at the build folders alone", () => {
    const build = {
      ...uvBuildEnvFor(runtimeDir, new Date("2026-10-13Z")),
      ...nodeBuildEnvFor(runtimeDir),
    };
    const { caches, config } = runtimeLayout(runtimeDir);
    expect(
      Object.values(build).filter((value) =>
        [caches, config].some((chats) => value.startsWith(chats)),
      ),
    ).toEqual([]);
    expect(inRuntime(build)).toMatchInlineSnapshot(`
      {
        "MPLCONFIGDIR": "<runtime>/build/caches/matplotlib",
        "PIP_CONFIG_FILE": "<devNull>",
        "PNPM_HOME": "<runtime>/build/caches/pnpm-home",
        "PYTHONPYCACHEPREFIX": "<runtime>/build/caches/pycache",
        "UV_CACHE_DIR": "<runtime>/build/caches/uv",
        "UV_EXCLUDE_NEWER": "2026-10-06T00:00:00.000Z",
        "UV_NO_CONFIG": "1",
        "UV_PYTHON_DOWNLOADS": "automatic",
        "UV_PYTHON_INSTALL_DIR": "<runtime>/python",
        "UV_PYTHON_PREFERENCE": "only-managed",
        "UV_TOOL_BIN_DIR": "<runtime>/build/caches/uv-tools/bin",
        "UV_TOOL_DIR": "<runtime>/build/caches/uv-tools",
        "XDG_CACHE_HOME": "<runtime>/build/caches",
        "npm_config_cache": "<runtime>/build/caches/npm",
        "npm_config_devdir": "<runtime>/build/caches/node-gyp",
        "npm_config_globalconfig": "<runtime>/build/config/npmrc-global",
        "npm_config_userconfig": "<runtime>/build/config/npmrc",
        "pnpm_config_cache_dir": "<runtime>/build/caches/pnpm",
        "pnpm_config_confirm_modules_purge": "false",
        "pnpm_config_dlx_cache_max_age": "259200",
        "pnpm_config_global_bin_dir": "<runtime>/build/caches/pnpm-global-bin",
        "pnpm_config_global_dir": "<runtime>/build/caches/pnpm-global",
        "pnpm_config_globalconfig": "<runtime>/build/config/npmrc-global",
        "pnpm_config_init_package_manager": "false",
        "pnpm_config_minimum_release_age": "10080",
        "pnpm_config_npmrc_auth_file": "<runtime>/build/config/npmrc",
        "pnpm_config_state_dir": "<runtime>/build/caches/pnpm-state",
        "pnpm_config_store_dir": "<runtime>/build/caches/pnpm-store",
        "pnpm_config_strict_dep_builds": "false",
        "pnpm_config_update_notifier": "false",
        "pnpm_config_userconfig": "<runtime>/build/config/npmrc",
        "pnpm_config_verify_deps_before_run": "false",
      }
    `);
    expect(
      readdirSync(runtimeLayout(runtimeDir).buildConfig).toSorted(),
    ).toEqual(["npmrc", "npmrc-global"]);
  });
});
