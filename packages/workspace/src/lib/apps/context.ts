import { APP_COMMAND } from "../shell-commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { APP_FILE_NAME } from "./app-file";
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
      `- ${app.slug} (${app.name}${app.manifest.account ? `, signed in as ${app.manifest.account}` : ""}, ${app.manifest.type === "web" ? `web at ${app.manifest.url}` : app.manifest.type}): ${describeConnection(connections[app.slug], app.manifestHash)}`,
  );
  for (const entry of invalid) {
    rows.push(`- ${entry.slug}: broken manifest, ${entry.message}`);
  }
  const known = getAppCatalog()
    .map((entry) => entry.slug)
    .join(", ");

  return [
    rows.length > 0
      ? `Apps in this workspace, each a folder named for it under ${shellPath(appsDir)}/ holding an ${APP_FILE_NAME} whose \`id\` is what the \`${APP_COMMAND.name}\` command calls it by, listed by that id (\`${APP_COMMAND.name} list\` for the current standing):\n${rows.join("\n")}`
      : `No apps are connected yet. An app is a service you reach with the \`${APP_COMMAND.name}\` command once it is set up as a folder under ${shellPath(appsDir)}/ holding an ${APP_FILE_NAME}.`,
    `The directory (\`${APP_COMMAND.name} catalog <words>\`) knows these services and how they are reached: ${known}.`,
  ].join("\n");
}
