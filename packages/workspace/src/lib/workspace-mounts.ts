import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Virtual mount point of the workspace's own `skills/` directory.
 *
 * Writable, unlike the read-only attached folders: authoring a skill is editing
 * a plain package of files, so the agent does it with the ordinary file tools
 * rather than a dedicated tool. Only the workspace's skills live here -- skills
 * discovered in a co-installed agent's home directory stay readable through
 * `load_skill` and are never exposed for writing.
 */
export const SKILLS_MOUNT_POINT = "/skills";

/** The workspace's own writable mounts, in the order they are advertised. */
export const WORKSPACE_MOUNT_KINDS = ["skills"] as const;

/** Which of the workspace's own writable mounts a directory or write belongs to. */
export type WorkspaceMountKind = (typeof WORKSPACE_MOUNT_KINDS)[number];

/**
 * What each writable workspace mount is made of.
 *
 * A mount holds one directory per package, identified by an entry file at its
 * root. Everything that treats a mount generically -- creating the directory,
 * mounting it writable, attributing a turn's writes to a package -- reads this
 * table, so a second writable mount is an entry here rather than a parallel set
 * of modules.
 */
export const WORKSPACE_MOUNTS: Record<WorkspaceMountKind, WorkspaceMountSpec> = {
  skills: {
    entryFile: "SKILL.md",
    mountPoint: SKILLS_MOUNT_POINT,
    resolveHostRoot: () =>
      absolutePathJoin(
        getWorkspaceConfig().rootDir,
        REGISTRY_FOLDER_NAMES.skills,
      ),
  },
};

interface WorkspaceMountSpec {
  /**
   * File whose presence at the root of a top-level directory makes it a real
   * package of this kind rather than a stray folder left behind mid-edit.
   */
  entryFile: string;
  /** Absolute, normalized virtual path the directory appears at. */
  mountPoint: string;
  /**
   * Real directory backing the mount. Resolved per call rather than captured at
   * module load, because the workspace root is configured after import and
   * changes between tests.
   */
  resolveHostRoot: () => AbsolutePath;
}

/** The workspace's own writable skills directory. */
export function getWorkspaceSkillsDir(): AbsolutePath {
  return WORKSPACE_MOUNTS.skills.resolveHostRoot();
}
