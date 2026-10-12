import { MOUNT } from "../../mount-points";
import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { getAppCatalog } from "./catalog";
import { describeConnection } from "./connection";
import { listApps } from "./store";

/**
 * What the chat is told about apps when its session starts: the apps
 * the workspace has and where each stands, and what the directory knows, so
 * a request naming a well-known service needs no lookup. What changes after
 * this arrives as app events on later turns; `app list` is the ground truth.
 */
export async function buildAppsContextText(): Promise<string> {
  const { apps: config, appsDir } = getWorkspaceConfig();
  const { apps, invalid } = await listApps(appsDir);
  const connections = await config.connections.list();

  const rows = apps.map(
    (app) =>
      `- ${app.slug} (${app.manifest.name}${app.manifest.account ? `, signed in as ${app.manifest.account}` : ""}, ${app.manifest.type === "web" ? `web at ${app.manifest.url}` : app.manifest.type}): ${describeConnection(connections[app.slug], app.manifestHash)}`,
  );
  for (const entry of invalid) {
    rows.push(`- ${entry.slug}: broken manifest, ${entry.message}`);
  }
  const known = getAppCatalog()
    .map((entry) => entry.slug)
    .join(", ");

  return [
    rows.length > 0
      ? `Apps in this workspace, at ${MOUNT.apps}/<slug>/ (\`${APP_COMMAND.name} list\` for the current standing):\n${rows.join("\n")}`
      : `No apps are connected yet. An app is a service you reach with the \`${APP_COMMAND.name}\` command once it is set up under ${MOUNT.apps}/<slug>/.`,
    `The directory (\`${APP_COMMAND.name} catalog <words>\`) knows these services and how they are reached: ${known}.`,
  ].join("\n");
}
