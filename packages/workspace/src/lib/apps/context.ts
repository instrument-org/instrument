import { APP_NAME } from "@instrument-org/shared";

import { instructionsInContext } from "../instructions-in-context";
import { APP_COMMAND } from "../../model-text/commands/app-command";
import { getWorkspaceConfig } from "../workspace-config";
import { getAppCatalog } from "./catalog";
import {
  type AppConnection,
  describeConnection,
  isConnected,
} from "./connection";
import { connectedElsewhere } from "./elsewhere";
import { signsInDirectly } from "./site";
import { grokPlanSignedIn, isXApp } from "./x-site";
import { type AppInfo, listApps, readAppGuide } from "./store";

/**
 * What the chat is told about apps when its session starts: the apps
 * the workspace has and where each stands, what the directory knows, so
 * a request naming a well-known service needs no lookup, and the
 * instructions of every app that is connected and every web app. What changes after this
 * arrives as app events on later turns; `instrument app list` is the ground truth.
 */
export async function buildAppsContextText(): Promise<string> {
  const { apps: config } = getWorkspaceConfig();
  const { apps, invalid } = await listApps();
  const connections = await config.connections.list();
  const elsewhere = await connectedElsewhere(apps);

  const rows = apps.map(
    (app) =>
      `- ${app.slug} (${app.name}${app.manifest.account ? `, signed in as ${app.manifest.account}` : ""}, ${app.manifest.type === "web" ? `web at ${app.manifest.url}` : app.manifest.type}${isXApp(app.manifest) ? `, with ${APP_NAME}'s X tools: \`${APP_COMMAND.name} tools ${app.slug}\`` : ""}): ${appStanding(app, connections[app.slug], { nextSteps: false })}${standingElsewhere(app, connections, elsewhere)}`,
  );
  for (const entry of invalid) {
    rows.push(`- ${entry.slug}: broken manifest, ${entry.message}`);
  }
  const known = getAppCatalog()
    .map((entry) => entry.slug)
    .join(", ");

  const standing = await Promise.all(
    apps
      // A web app is worked on its site whether or not this computer has
      // seen it signed in, so its guide counts either way.
      .filter(
        (app) =>
          app.manifest.type === "web" ||
          isConnected(connections[app.slug], app.manifestHash),
      )
      .map(appInstructionsText),
  );

  const lines = [
    rows.length > 0
      ? `Apps in this workspace, by the id the \`${APP_COMMAND.name}\` command names each by (\`${APP_COMMAND.name} list\` for the current standing):\n${rows.join("\n")}`
      : `No apps are connected yet. An app is a service you reach with the \`${APP_COMMAND.name}\` command once it is set up with it.`,
    `The directory (\`${APP_COMMAND.name} catalog <words>\`) knows these services and how they are reached: ${known}.`,
  ];

  return [lines.join("\n"), ...standing.filter((text) => text !== undefined)]
    .join("\n\n")
    .trimEnd();
}

/**
 * One connected app's instructions, its guide, inlined by the same rule as a
 * project's: the whole of them up to the budget, and past it what fits with
 * the command that prints the rest. Nothing for an app with no guide.
 */
async function appInstructionsText(app: AppInfo): Promise<string | undefined> {
  const instructions = instructionsInContext({
    file: `\`${APP_COMMAND.name} guide ${app.slug}\``,
    instructions: (await readAppGuide(app.slug)) ?? undefined,
  });
  return instructions === undefined
    ? undefined
    : `The instructions for "${app.name}" (${app.slug}), its guide:\n<app_instructions>\n${instructions}\n</app_instructions>`;
}

/**
 * Where an app stands on this computer, as a listing says it: its
 * connection, and for an X app, the Grok plan its search runs on beside its
 * site's sign-in.
 */
export function appStanding(
  app: AppInfo,
  connection: AppConnection | undefined,
  { nextSteps = true }: { nextSteps?: boolean } = {},
): string {
  const { manifest } = app;
  const standing = describeConnection(connection, app.manifestHash, {
    direct: signsInDirectly(manifest),
    nextSteps,
    web: manifest.type === "web",
  });
  if (!isXApp(manifest) || manifest.type !== "web") {
    return standing;
  }
  const plan = grokPlanSignedIn()
    ? "signed in"
    : "not signed in on this computer";
  return `search through the Grok plan (${plan}) · ${new URL(manifest.url).host} ${standing}`;
}

/** Where an app not connected here is connected on another computer, as the end of its line. */
export function standingElsewhere(
  app: AppInfo,
  connections: Record<string, AppConnection>,
  elsewhere: Map<string, string>,
): string {
  const clause = elsewhere.get(app.slug);
  return clause === undefined ||
    isConnected(connections[app.slug], app.manifestHash)
    ? ""
    : `; ${clause}`;
}
