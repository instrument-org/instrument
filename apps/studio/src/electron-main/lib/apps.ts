import { getAuthServerPort } from "@/electron-main/auth/state";
import { appConnectionStore } from "@/electron-main/stores/app-connections";
import {
  getAppCredential,
  removeAppCredential,
} from "@/electron-main/stores/app-credentials";
import { appOAuthStore, clearAppOAuth } from "@/electron-main/stores/app-oauth";
import { PORTS } from "@instrument-org/shared";
import {
  loadApp,
  type WorkspaceConfig,
  workspacePublisher,
} from "@instrument-org/workspace/electron";

/** The loopback route the provider sends the browser back to after a sign-in. */
export const APP_OAUTH_CALLBACK_PATH = "/auth/callback/app";

// The workspace's apps directory, kept here once the workspace boots: the
// sign-in callback names an app by its manifest and runs outside any RPC
// context that would carry the config.
let appsDirRef: undefined | WorkspaceConfig["appsDir"];

export function getAppsDir(): undefined | WorkspaceConfig["appsDir"] {
  return appsDirRef;
}

export function rememberAppsDir(appsDir: WorkspaceConfig["appsDir"]): void {
  appsDirRef = appsDir;
}

const DEFAULT_PORT =
  process.env.NODE_ENV === "development"
    ? PORTS.authCallback.dev
    : PORTS.authCallback.prod;

/** Tell the window and the orchestrator that a sign-in just went through. */
export async function announceConnected(
  appsDir: WorkspaceConfig["appsDir"],
  slug: string,
) {
  const connection = await appConnectionStore.get(slug);
  workspacePublisher.publish("app.updated", null);
  workspacePublisher.publish("app.event", {
    detail:
      connection?.toolCount === undefined
        ? undefined
        : `${connection.toolCount} tools`,
    event: "connected",
    name: await appName(appsDir, slug),
    slug,
  });
}

/** The app's own name for a note, falling back to the slug when the folder is gone. */
export async function appName(
  appsDir: WorkspaceConfig["appsDir"],
  slug: string,
): Promise<string> {
  const loaded = await loadApp(appsDir, slug);
  return loaded.isOk() ? loaded.value.manifest.name : slug;
}

/**
 * The redirect URL a sign-in registers, built from the port the callback
 * server actually bound rather than the default it asks for: a second
 * running instance takes the default, and a sign-in sent back to it would
 * land on a server that knows nothing of the flow.
 */
export function appOAuthRedirectUrl(): string {
  return `http://127.0.0.1:${getAuthServerPort() ?? DEFAULT_PORT}${APP_OAUTH_CALLBACK_PATH}`;
}

/**
 * What the workspace gets to keep about apps: the encrypted credential and
 * token stores, the connection records, and the way to tell the window that
 * any of them changed.
 */
export function createAppsConfig(): WorkspaceConfig["apps"] {
  return {
    connections: appConnectionStore,
    disconnect: disconnectApp,
    getCredential: (slug) => Promise.resolve(getAppCredential(slug)),
    notifyChanged: () => {
      workspacePublisher.publish("app.updated", null);
    },
    oauth: {
      redirectUrl: appOAuthRedirectUrl,
      store: appOAuthStore,
    },
  };
}

/**
 * Take an app's key, tokens, and connection away, leaving its folder, and
 * tell both the window and the orchestrator.
 */
export async function disconnectApp(
  slug: string,
  {
    appsDir,
    event = "disconnected",
  }: {
    appsDir?: WorkspaceConfig["appsDir"];
    /** Whether the folder goes too, which the note to the orchestrator says. */
    event?: "disconnected" | "removed";
  } = {},
): Promise<void> {
  removeAppCredential(slug);
  clearAppOAuth(slug);
  await appConnectionStore.remove(slug);
  workspacePublisher.publish("app.updated", null);
  const name = appsDir ? await appName(appsDir, slug) : slug;
  workspacePublisher.publish("app.event", { event, name, slug });
}
