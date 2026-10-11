/**
 * The virtual filesystem paths the agent writes, and everything else agrees on.
 *
 * One object because they are one vocabulary: a prompt that names where files
 * live usually names two or three of these in a sentence, and a reader looking
 * up any of them wants to see the set. This file imports nothing, so the
 * renderer can name a mount without dragging `just-bash` and `node:fs` along,
 * and there is nowhere else for a new one to drift to.
 *
 * `/dev` is deliberately absent. It exists so the shell idiom of redirecting
 * into a sink resolves instead of failing, and it is not part of the agent's
 * working surface, so it stays private to the layout that mounts it.
 */
export const MOUNT = {
  /**
   * The workspace's own `apps/` directory: one folder per app the agent has
   * set up, each holding a manifest and a guide and never a secret.
   *
   * Writable for the chat, which authors apps; a task reaches its apps
   * through the `app` command rather than the folder.
   */
  apps: "/apps",

  /**
   * Root of the folder mounts (e.g. `/mnt/Photos`): every folder the chat
   * reaches on the user's real disk (the home folder, the workspace folder,
   * the folders granted in the chat and those of its topics), each read and
   * write unless it holds the workspace. The path schemas, the mount points,
   * and the asset server all derive from it.
   */
  folders: "/mnt",

  /**
   * The skills the agent can see, one mount per skill source at
   * `/skills/<source>/`. The segment carries provenance and writability: only
   * the workspace's own skills (`WORKSPACE_SKILLS_MOUNT`) are writable, because
   * authoring a skill is editing a plain package of files with the ordinary file
   * tools. What the app ships and what a co-installed agent left in its home
   * directory are read-only where they were discovered.
   */
  skills: "/skills",

  /**
   * The agent's working folder, and its working directory: the chat's own
   * folder, which its tasks share.
   *
   * A named home rather than the filesystem root, so the agent has a clear,
   * stable place to work and is less prone to hallucinating host paths.
   * Relative paths (`work/`, `attachments/`) are unaffected, since
   * the working directory is this mount. Every virtual/real translator routes
   * through the layout, so this is the single value to change.
   */
  task: "/task",
} as const;

/**
 * The workspace's own skills folder, the one place under `MOUNT.skills` the
 * agent writes. `workspace` is that source's mount segment
 * (`skillsMountSegment` in `lib/skills.ts`).
 */
export const WORKSPACE_SKILLS_MOUNT = `${MOUNT.skills}/workspace`;
