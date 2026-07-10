import { err, ok, type Result } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";
import { absolutePathJoin } from "../absolute-path-join";
import {
  CONNECTOR_GUIDE_FILE_NAME,
  CONNECTOR_MANIFEST_FILE_NAME,
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorSlug,
  ConnectorSlugSchema,
} from "./manifest";

interface ConnectorInfo {
  dir: AbsolutePath;
  manifest: ConnectorManifest;
  slug: ConnectorSlug;
}

interface ConnectorLoadError {
  message: string;
  reason: "invalid-manifest" | "invalid-slug" | "not-found";
}

/**
 * Read every connector folder under `connectorsDir`. Folders whose manifest
 * fails to parse are returned separately so callers (settings UI, tests tool)
 * can surface the problem instead of silently hiding the connector.
 */
export async function listConnectors(connectorsDir: AbsolutePath): Promise<{
  connectors: ConnectorInfo[];
  invalid: { message: string; slug: string }[];
}> {
  let entries;
  try {
    entries = await fs.readdir(connectorsDir, { withFileTypes: true });
  } catch {
    return { connectors: [], invalid: [] };
  }

  const connectors: ConnectorInfo[] = [];
  const invalid: { message: string; slug: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    const result = await loadConnector(connectorsDir, entry.name);
    if (result.isOk()) {
      connectors.push(result.value);
    } else if (result.error.reason !== "not-found") {
      invalid.push({ message: result.error.message, slug: entry.name });
    }
  }

  return { connectors, invalid };
}

export async function loadConnector(
  connectorsDir: AbsolutePath,
  rawSlug: string,
): Promise<Result<ConnectorInfo, ConnectorLoadError>> {
  const slugResult = ConnectorSlugSchema.safeParse(rawSlug);
  if (!slugResult.success) {
    return err({
      message: `"${rawSlug}" is not a valid connector slug (lowercase letters, digits, and hyphens).`,
      reason: "invalid-slug",
    });
  }
  const slug = slugResult.data;
  const dir = absolutePathJoin(connectorsDir, slug);
  const manifestPath = path.join(dir, CONNECTOR_MANIFEST_FILE_NAME);

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch {
    return err({
      message: `Connector "${slug}" has no ${CONNECTOR_MANIFEST_FILE_NAME}.`,
      reason: "not-found",
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return err({
      message: `${CONNECTOR_MANIFEST_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      reason: "invalid-manifest",
    });
  }

  const parsed = ConnectorManifestSchema.safeParse(json);
  if (!parsed.success) {
    return err({
      message: `${CONNECTOR_MANIFEST_FILE_NAME} is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      reason: "invalid-manifest",
    });
  }

  return ok({ dir, manifest: parsed.data, slug });
}

export async function readConnectorGuide(
  connectorDir: AbsolutePath,
): Promise<null | string> {
  try {
    const guide = await fs.readFile(
      path.join(connectorDir, CONNECTOR_GUIDE_FILE_NAME),
      "utf8",
    );
    return guide.trim() === "" ? null : guide;
  } catch {
    return null;
  }
}

/**
 * Rewrite a connector's manifest with `enabled` flipped. Used by the connector
 * test to enable on a green run. Preserves the parsed shape (2-space JSON) so
 * the on-disk file stays hand-editable.
 */
export async function setConnectorEnabled(
  connector: ConnectorInfo,
  enabled: boolean,
): Promise<void> {
  const manifestPath = path.join(connector.dir, CONNECTOR_MANIFEST_FILE_NAME);
  const next: ConnectorManifest = { ...connector.manifest, enabled };
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}
