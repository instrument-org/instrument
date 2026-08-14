/**
 * The virtual filesystem paths the agent writes, and everything else agrees on.
 *
 * One object because they are one vocabulary: a prompt that names where files
 * live usually names two or three of these in a sentence, and a reader looking
 * up any of them wants to see the set. They were three modules apart for
 * reasons of import weight rather than meaning -- `/project` carries a comment
 * recording that it was moved out of `workspace-fs-layout` so the renderer
 * could name it without dragging `just-bash` and `node:fs` along. This file
 * imports nothing, so that pressure is gone and there is nowhere else for the
 * fourth one to drift to.
 *
 * `/dev` is deliberately absent. It exists so the shell idiom of redirecting
 * into a sink resolves instead of failing, and it is not part of the agent's
 * working surface, so it stays private to the layout that mounts it.
 */
export const MOUNT = {
  /**
   * Root of the attached-folder mounts (e.g. `/mnt/Photos`). Attached folders
   * live on the user's real disk and are surfaced under this prefix, read-only
   * or read-write according to the access the user granted each one. The path
   * schemas, the attached-folder mount points, and the asset server all derive
   * from it.
   */
  attachedFolders: "/mnt",

  /**
   * The folder of the project a task belongs to.
   *
   * Top-level and singular rather than a name under `/mnt`, because a task
   * belongs to at most one project: `/mnt` entries need names to tell several
   * folders apart, and this one has nothing to be told apart from. A fixed path
   * also survives a project rename, which moves the real directory
   * (`updateProject`) and would otherwise change the path mid-task.
   */
  project: "/project",

  /**
   * The workspace's own `skills/` directory.
   *
   * Always writable, whatever access the attached folders have: authoring a
   * skill is editing a plain package of files, so the agent does it with the
   * ordinary file tools rather than a dedicated tool. Only the workspace's
   * skills live here -- skills discovered in a co-installed agent's home
   * directory stay readable through `load_skill` and are never exposed for
   * writing.
   */
  skills: "/skills",

  /**
   * The task itself, and the agent's working directory.
   *
   * A named home rather than the filesystem root, so the agent has a clear,
   * stable place to work and is less prone to hallucinating host paths.
   * Relative paths (`work/`, `output/`, `attachments/`) are unaffected, since
   * the working directory is this mount. Every virtual/real translator routes
   * through the layout, so this is the single value to change.
   */
  task: "/task",
} as const;
