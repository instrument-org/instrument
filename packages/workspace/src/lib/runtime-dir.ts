import path from "node:path";

// Depends on nothing of the workspace's, so the app's main process and the
// sandbox bake-off probe lay out the same folders the workspace reads.

/**
 * The folders in `runtimeDir`, the one folder on this computer for what the
 * app can always rebuild, shared by every workspace on it. Nothing in it is
 * copied or carried over: what is missing is made again when it is used.
 */
export function runtimeLayout(runtimeDir: string) {
  return {
    /**
     * Links to the programs the app ships, first on the PATH of everything
     * it starts. Made again at each launch.
     */
    bin: path.join(runtimeDir, "bin"),
    /**
     * The caches the app builds from, or runs from, what every chat then
     * runs: the environments of the skills it ships, the managed Python, a
     * connected app's local Python server. No chat reaches it, so nothing a
     * chat wrote ends up in them; a build the app runs for a chat reaches
     * it, and no other command of that chat's.
     */
    buildCaches: path.join(runtimeDir, "build", "caches"),
    /**
     * The settings those builds read: their own `XDG_CONFIG_HOME` and empty
     * npm config files. A build reads it, and nothing a chat runs reaches it.
     */
    buildConfig: path.join(runtimeDir, "build", "config"),
    /**
     * What a chat's programs keep for themselves and can lose: uv's cache
     * and the tools it installs, the pnpm store, npm's cache, node-gyp's
     * headers, and on Windows model downloads (`XDG_CACHE_HOME` there,
     * `modelCachesEnvFor`). Native commands read and write it, so the app
     * neither builds nor loads anything from it.
     */
    caches: path.join(runtimeDir, "caches"),
    /**
     * Where a chat's programs keep their settings: `XDG_CONFIG_HOME`, and
     * the app's own empty npm config files. Native commands read and write
     * it, so no build the app runs reads it.
     */
    config: path.join(runtimeDir, "config"),
    /**
     * One environment per skill dependency set, which the app builds and
     * native commands only read: a Python skill's per `uv.lock`, a Node
     * skill's per version of the skill, each named by a hash of what
     * defines it (`skill-environments.ts`).
     */
    environments: path.join(runtimeDir, "environments"),
    /**
     * The store, caches and settings of the pnpm install step the app runs
     * outside the sandbox for a chat (`pnpm-outside.ts`). Native commands
     * only read its store, so no chat can plant a link or a file there that
     * the unsandboxed pnpm would follow or copy.
     */
    installCaches: path.join(runtimeDir, "install", "caches"),
    /** That install step's own empty npm config files and `XDG_CONFIG_HOME`. */
    installConfig: path.join(runtimeDir, "install", "config"),
    /**
     * What the app loads into the programs a chat runs, which native
     * commands only read: the preload every `node` imports and the
     * `instrument` module every `python` finds. The app writes it, so no
     * chat can change what another chat's programs load.
     */
    preload: path.join(runtimeDir, "preload"),
    /**
     * The managed Python every chat's virtualenv is made from, which the app
     * installs and native commands only read.
     */
    python: path.join(runtimeDir, "python"),
    /**
     * The packages every chat's virtualenv imports, which the app installs
     * and refreshes (`python-base.ts`) and native commands only read: a file
     * one chat put there would import in every other.
     */
    pythonBase: path.join(runtimeDir, "python-base"),
    /** What stands in for a closed file under bubblewrap. */
    sandbox: path.join(runtimeDir, "sandbox"),
    /**
     * The skills the app ships, copied out of its signed bundle at each
     * launch, which native commands only read.
     */
    skills: path.join(runtimeDir, "skills"),
  };
}
