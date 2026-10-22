import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { AUTH_CALLBACK_PATHS } from "@/electron-main/auth/routes";
import { getAuthServerPort } from "@/electron-main/auth/state";
import {
  directoryIconDataUri,
  iconDataUri,
} from "@/electron-main/lib/directory-icons";
import { appConnectionStore } from "@/electron-main/stores/workspace/app-connections";
import {
  getAppCredential,
  removeAppCredential,
} from "@/electron-main/stores/workspace/app-credentials";
import {
  appOAuthStore,
  clearAppOAuth,
} from "@/electron-main/stores/workspace/app-oauth";
import { settleSignIn } from "@/electron-main/browser-view/history-intents";
import { settleConnection } from "@/electron-main/lib/app-connection";
import { PORTS } from "@instrument-org/shared";
import {
  cancelMcpOAuth,
  catalogEntryForApp,
  completeMcpOAuth,
  findAppIcon,
  loadApp,
  appChanged,
  pendingMcpOAuthSlug,
  type WorkspaceConfig,
} from "@instrument-org/workspace/electron";

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

/** Tell the window and the chat that a sign-in just went through. */
export async function announceConnected(slug: string) {
  const connection = await appConnectionStore.get(slug);
  await appChanged(slug, {
    ...(connection?.toolCount === undefined
      ? {}
      : { detail: `${connection.toolCount} tools` }),
    event: "connected",
  });
}

/** The app's own name for a note, falling back to the slug when the folder is gone. */
export async function appName(
  appsDir: WorkspaceConfig["appsDir"],
  slug: string,
): Promise<string> {
  const loaded = await loadApp(appsDir, slug);
  return loaded.isOk() ? loaded.value.name : slug;
}

/**
 * The app's mark for the page a sign-in lands on, as a data address: its own
 * icon, else the directory's for the service it reaches.
 */
export async function appMark(
  appsDir: WorkspaceConfig["appsDir"],
  slug: string,
): Promise<string | undefined> {
  const loaded = await loadApp(appsDir, slug);
  if (loaded.isErr()) {
    return undefined;
  }
  const { dir, manifest } = loaded.value;
  const own = await findAppIcon(dir).catch(() => undefined);
  if (own) {
    return iconDataUri(own.bytes, own.fileName);
  }
  const entry = catalogEntryForApp(slug, manifest);
  return entry ? directoryIconDataUri(entry.slug) : undefined;
}

/**
 * The redirect URL a sign-in registers, built from the port the callback
 * server actually bound rather than the default it asks for: a second
 * running instance takes the default, and a sign-in sent back to it would
 * land on a server that knows nothing of the flow.
 */
export function appOAuthRedirectUrl(): string {
  return `http://127.0.0.1:${getAuthServerPort() ?? DEFAULT_PORT}${AUTH_CALLBACK_PATHS.app}`;
}

const STAGING_API_BASE_URL = "https://staging.api.tryinstrument.com";

/**
 * Where a vendor sends back a sign-in made with Instrument's own client for
 * `service`: our API's relay, which passes the browser on to the loopback
 * port the state names. The vendor takes only the https addresses registered
 * with it, so an API running on this machine borrows staging's relay.
 */
export function appOAuthRelayUrl(service: string): string {
  return `${relayApiBase()}/oauth/${service}/callback`;
}

/**
 * Where a sign-in made with Instrument's own client for `service` is redeemed
 * and refreshed when our API holds the client's secret: the same API as the
 * relay, since the vendor checks the code against the redirect it was sent to.
 */
export function appOAuthTokenUrl(service: string): string {
  return `${relayApiBase()}/oauth/${service}/token`;
}

function relayApiBase(): string {
  const api = URL.parse(platformApiBaseUrl());
  return api?.protocol === "https:" ? api.origin : STAGING_API_BASE_URL;
}

/**
 * What the workspace gets to keep about apps: the encrypted credential and
 * token stores, and the connection records.
 */
export function createAppsConfig(): WorkspaceConfig["apps"] {
  return {
    connections: appConnectionStore,
    disconnect: disconnectApp,
    getCredential: (slug) => Promise.resolve(getAppCredential(slug)),
    oauth: {
      redirectUrl: appOAuthRedirectUrl,
      relayRedirectUrl: appOAuthRelayUrl,
      relayTokenUrl: appOAuthTokenUrl,
      store: appOAuthStore,
    },
  };
}

/**
 * Take an app's key, tokens, and connection away, leaving its folder, and
 * tell both the window and the chat.
 */
export async function disconnectApp(
  slug: string,
  {
    event = "disconnected",
  }: {
    /** Whether the folder goes too, which the note to the chat says. */
    event?: "disconnected" | "removed";
  } = {},
): Promise<void> {
  removeAppCredential(slug);
  clearAppOAuth(slug);
  await appConnectionStore.remove(slug);
  await appChanged(slug, { event });
}

/** How a sign-in that came back to the app callback ended, for its page. */
export type AppCallbackOutcome =
  | { opensIn: "app" | "external"; outcome: "connected"; slug: string }
  | { outcome: "declined"; slug: string }
  /** The service would not let this account connect, by its own rule. */
  | { outcome: "refused"; slug: string }
  /** The browser came back to a sign-in nobody was waiting for. */
  | { outcome: "expired" }
  | { error: string; outcome: "failed"; slug: string };

// What a vendor writes when the person on its page turned the sign-in
// down: the RFC's own words, and Microsoft's code for a declined consent.
const USER_DENIAL =
  /\bAADSTS65004\b|\buser (?:has )?(?:denied|declined|cancell?ed)\b|\bdenied by (?:the )?user\b|\bresource owner or authorization server denied\b/i;

// What a vendor writes when its own rule stops the account: a Microsoft
// AADSTS code, an administrator's consent or approval, a policy.
const VENDOR_POLICY =
  /\bAADSTS\d+|\badmin(?:istrator)?\b|\bpolicy\b|\bconsent\b|\bapproval\b|\borgani[sz]ation\b|\btenant\b|\bnot (?:allowed|permitted|authorized)\b|\bblocked\b/i;

/**
 * Whether an OAuth error the provider sent the browser back with is the user
 * turning the sign-in down on its page, or the service refusing the account.
 * Only `access_denied` with nothing but a denial in its description is the
 * user's doing; any other error, or a denial whose description names a
 * policy (an admin's consent, an AADSTS code), is the service's.
 */
export function signInRefusalOf({
  description,
  error,
}: {
  description: string | undefined;
  error: string;
}): "declined" | "refused" {
  if (error !== "access_denied") {
    return "refused";
  }
  if (description === undefined || description.trim() === "") {
    return "declined";
  }
  if (USER_DENIAL.test(description)) {
    return "declined";
  }
  return VENDOR_POLICY.test(description) ? "refused" : "declined";
}

/**
 * Finish the parked sign-in an app's provider sent the browser back for: the
 * code becomes tokens and the app becomes connected; the user turning it down
 * on the provider's page is a decline, the same as "Not now" on the card;
 * and the service refusing the account is a failed sign-in whose next step
 * is the web. Either way the window and the chat hear of it.
 */
export async function receiveAppCallback(
  params: URLSearchParams,
): Promise<AppCallbackOutcome> {
  const code = params.get("code") ?? undefined;
  const state = params.get("state") ?? undefined;
  const oauthError = params.get("error") ?? undefined;
  const oauthErrorDescription = params.get("error_description") ?? undefined;
  const appsDir = getAppsDir();
  const slug = state === undefined ? undefined : pendingMcpOAuthSlug(state);
  // The sign-in's pages in the window's browser end with this one: where
  // the tab goes next is the person's own history again.
  if (slug !== undefined) {
    settleSignIn(slug);
  }
  if (state !== undefined && (oauthError !== undefined || code === undefined)) {
    // Denied, refused, or abandoned in the provider's page: the flow is torn
    // down.
    await cancelMcpOAuth(state);
    if (slug === undefined || !appsDir) {
      return { outcome: "expired" };
    }
    if (oauthError === undefined) {
      // Neither a code nor an error: the service broke off the sign-in
      // without saying why, which is nothing the user said.
      const error = "The service sent the sign-in back without finishing it.";
      await settleConnection(slug, { error, status: "failed" });
      return { error, outcome: "failed", slug };
    }
    if (
      signInRefusalOf({
        description: oauthErrorDescription,
        error: oauthError,
      }) === "refused"
    ) {
      await settleConnection(slug, {
        ended: "refused",
        error: oauthErrorDescription
          ? `${oauthError}: ${oauthErrorDescription}`
          : oauthError,
        status: "failed",
      });
      return { outcome: "refused", slug };
    }
    await settleConnection(slug, { status: "declined" });
    return { outcome: "declined", slug };
  }
  if (code === undefined || state === undefined) {
    return { outcome: "expired" };
  }
  const result = await completeMcpOAuth({ code, state });
  if (result.isErr()) {
    // No flow was waiting for this state: an old tab or a second visit.
    if (slug === undefined) {
      return { outcome: "expired" };
    }
    if (appsDir) {
      await settleConnection(slug, {
        error: result.error.message,
        status: "failed",
      });
    }
    return { error: result.error.message, outcome: "failed", slug };
  }
  if (appsDir) {
    await announceConnected(result.value.slug);
  }
  return {
    opensIn: result.value.opensIn,
    outcome: "connected",
    slug: result.value.slug,
  };
}
