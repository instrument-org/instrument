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
     * What programs keep for themselves and can lose: uv's cache and the
     * tools it installs, the pnpm store, npm's cache, node-gyp's headers,
     * model downloads. `XDG_CACHE_HOME` for every native command, which
     * reads and writes it.
     */
    caches: path.join(runtimeDir, "caches"),
    /**
     * Where programs keep their settings: `XDG_CONFIG_HOME`, and the app's
     * own empty npm config files. Native commands read and write it.
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
     * The managed Python every chat's virtualenv is made from, which the app
     * installs and native commands only read.
     */
    python: path.join(runtimeDir, "python"),
    /** What stands in for a closed file under bubblewrap. */
    sandbox: path.join(runtimeDir, "sandbox"),
    /**
     * The skills the app ships, copied out of its signed bundle at each
     * launch, which native commands only read.
     */
    skills: path.join(runtimeDir, "skills"),
  };
}
