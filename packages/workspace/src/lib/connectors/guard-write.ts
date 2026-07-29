import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";
import { getWorkspaceConnectorsDir } from "../workspace-fs-layout";
import { CONNECTOR_MANIFEST_FILE_NAME } from "./manifest";
import { loadConnector } from "./store";

/**
 * Guards against silently destroying a working connector. A wholesale
 * `write_file` of `connectors/<slug>/connector.json` over a connector that is
 * currently *enabled* would reset it (e.g. a setup re-run writing
 * `enabled: false`), disabling a connector the user relies on. New connectors,
 * disabled ones, and broken manifests are fair game -- only an enabled
 * connector is protected, and edits should go through `edit_file` instead.
 *
 * Returns an error message to surface, or null when the write is allowed.
 */
export async function guardConnectorManifestOverwrite(
  absolutePath: AbsolutePath,
): Promise<null | string> {
  const connectorsDir = getWorkspaceConnectorsDir();
  const normalized = path.normalize(absolutePath);
  const connectorsRoot = path.normalize(connectorsDir);
  if (!normalized.startsWith(connectorsRoot + path.sep)) {
    return null;
  }

  // Only the real manifest at exactly `connectors/<slug>/connector.json` is a
  // connector manifest -- a `connector.json` nested deeper (e.g. under a
  // vendored package the agent wrote into the folder) is not, and must not
  // block the write.
  const segments = path.relative(connectorsRoot, normalized).split(path.sep);
  if (segments.length !== 2 || segments[1] !== CONNECTOR_MANIFEST_FILE_NAME) {
    return null;
  }
  const slug = segments[0];
  if (!slug) {
    return null;
  }

  const existing = await loadConnector(connectorsDir, slug);
  if (existing.isErr() || !existing.value.manifest.enabled) {
    return null;
  }

  return (
    `Connector "${slug}" already exists and is enabled. Overwriting ${CONNECTOR_MANIFEST_FILE_NAME} ` +
    `would reset it and disable a connector the user is relying on. ` +
    `Reuse it as-is, or make a targeted change with edit_file (never a full rewrite). ` +
    `If you truly need to rebuild it, disable it first.`
  );
}
