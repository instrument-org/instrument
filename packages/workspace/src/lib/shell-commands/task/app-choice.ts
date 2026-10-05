import {
  describeConnection,
  isConnected,
  readConnection,
} from "../../apps/connection";
import { loadApp } from "../../apps/store";
import { getWorkspaceConfig } from "../../workspace-config";

/**
 * The apps a task is handed, each checked to be connected now: a task given
 * an app that cannot answer would fail on its first call and wake the
 * chat about it, which is a turn wasted on what this catches.
 */
export async function resolveApps(slugs: string[]): Promise<string[]> {
  const appsDir = getWorkspaceConfig().appsDir;
  const apps: string[] = [];
  for (const slug of slugs) {
    const loaded = await loadApp(appsDir, slug);
    if (loaded.isErr()) {
      throw new Error(`--app ${slug}: ${loaded.error.message}`);
    }
    const connection = await readConnection(loaded.value.slug);
    if (!isConnected(connection, loaded.value.manifestHash)) {
      throw new Error(
        `--app ${slug}: it is ${describeConnection(connection, loaded.value.manifestHash)}. Connect it first.`,
      );
    }
    if (!apps.includes(loaded.value.slug)) {
      apps.push(loaded.value.slug);
    }
  }
  return apps;
}

/**
 * A brief that tells the task to use an app the command did not hand it is
 * refused, with the flag to add: the task would fail on its first call and
 * wake the chat about it, which is a turn spent on what this catches.
 */
export function requireAppsNamedInBrief(prompt: string, apps: string[]) {
  const named = new Set(
    [
      ...prompt.matchAll(
        /\bapp (?:call|request|tools|guide) ([a-z0-9][a-z0-9-]*)/g,
      ),
    ].map((match) => match[1] ?? ""),
  );
  const missing = [...named].filter((slug) => slug && !apps.includes(slug));
  if (missing.length > 0) {
    throw new Error(
      `the brief tells the task to use ${missing.map((slug) => `"${slug}"`).join(", ")}, but a task reaches only the apps handed to it on the command. Add ${missing.map((slug) => `--app ${slug}`).join(" ")}.`,
    );
  }
}
