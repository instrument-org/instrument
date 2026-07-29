import { REGISTRY_FOLDER_NAMES } from "../constants";
import { type AbsolutePath } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { CONNECTOR_MANIFEST_FILE_NAME } from "./connectors/manifest";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * Virtual mount point of the workspace's own `connectors/` directory.
 *
 * Writable, on the same terms as the skills mount. Secrets never live here:
 * credentials stay in the app's encrypted store and are injected at request
 * time, so a connector folder holds only its manifest and its guide.
 */
export const CONNECTORS_MOUNT_POINT = "/connectors";

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
export const WORKSPACE_MOUNT_KINDS = ["skills", "connectors"] as const;

/** Which of the workspace's own writable mounts a directory or write belongs to. */
export type WorkspaceMountKind = (typeof WORKSPACE_MOUNT_KINDS)[number];

/**
 * What each writable workspace mount is made of.
 *
 * Skills and connectors hold the same shape of thing: one directory per package,
 * identified by an entry file at its root, authored by the agent with the
 * ordinary file tools. Everything that treats them alike -- creating the
 * directory, mounting it writable, attributing a turn's writes to a package --
 * reads this table instead of naming the two separately, so a third mount is an
 * entry here rather than a parallel set of modules.
 */
export const WORKSPACE_MOUNTS: Record<WorkspaceMountKind, WorkspaceMountSpec> =
  {
    connectors: {
      entryFile: CONNECTOR_MANIFEST_FILE_NAME,
      mountPoint: CONNECTORS_MOUNT_POINT,
      resolveHostRoot: () => getWorkspaceConfig().connectorsDir,
    },
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

/** The workspace's own writable connectors directory. */
export function getWorkspaceConnectorsDir(): AbsolutePath {
  return WORKSPACE_MOUNTS.connectors.resolveHostRoot();
}

/** The workspace's own writable skills directory. */
export function getWorkspaceSkillsDir(): AbsolutePath {
  return WORKSPACE_MOUNTS.skills.resolveHostRoot();
}
