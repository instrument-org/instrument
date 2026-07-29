import { type AbsolutePath } from "../../schemas/paths";
import { CONNECTORS_MOUNT_POINT } from "../workspace-fs-layout";
import { listConnectors } from "./store";

/**
 * A short, standing description of the connectors already present in the
 * workspace, injected into the agent's context each turn so it never
 * "rediscovers" (and clobbers) a connector the user already set up. Returns
 * null when there are none.
 */
export async function buildConnectorsContextText({
  connectorsDir,
  getCredential,
}: {
  connectorsDir: AbsolutePath;
  getCredential: (slug: string) => Promise<null | string>;
}): Promise<null | string> {
  const { connectors, invalid } = await listConnectors(connectorsDir);
  if (connectors.length === 0 && invalid.length === 0) {
    return null;
  }

  const rows = await Promise.all(
    connectors.map(async (connector) => {
      const needsCredential =
        connector.manifest.auth.kind !== "none" &&
        (await getCredential(connector.slug)) === null;
      const status = connector.manifest.enabled
        ? "enabled"
        : needsCredential
          ? "disabled, needs credential"
          : "disabled";
      return `- ${connector.slug} (${connector.manifest.displayName}) -- ${status}`;
    }),
  );

  for (const entry of invalid) {
    rows.push(`- ${entry.slug} -- broken manifest: ${entry.message}`);
  }

  return [
    `The workspace already has these data connectors at ${CONNECTORS_MOUNT_POINT}/<slug>/.`,
    `Do NOT recreate one that already exists -- reuse it. To change one, edit its files in place; never overwrite an enabled connector.`,
    ...rows,
  ].join("\n");
}
