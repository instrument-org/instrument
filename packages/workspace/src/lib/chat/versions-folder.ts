/** The folder in a chat's work folder its versions are kept in. */
export const VERSIONS_FOLDER = "Versions";

/**
 * Every name a chat's versions folder has had: `VERSIONS_FOLDER`, and
 * `.versions`, where an earlier build kept them and its records still point.
 */
export const VERSIONS_FOLDERS: readonly string[] = [
  VERSIONS_FOLDER,
  ".versions",
];
