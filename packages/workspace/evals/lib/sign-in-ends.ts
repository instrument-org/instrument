import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { appChanged } from "../../src/lib/apps/changed";
import {
  recordConnection,
  type SignInEnd,
} from "../../src/lib/apps/connection";
import { type McpOAuthStore } from "../../src/lib/apps/mcp/oauth-provider";
import { loadApp } from "../../src/lib/apps/store";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type OriginBound } from "../../src/lib/apps/origin-bound";
import { type WorkspaceAppsConfig } from "../../src/types";

/**
 * Sign-ins for a run that shows the card and has nobody to finish it: the
 * agent's `connect_app` puts a sign-in card up as it would in the app, and
 * `endSignIn` then plays the outcome the app's callback would record. The
 * store keeps what the card's start would write, in memory, for the process.
 */
export function cardOnlySignIns(): NonNullable<WorkspaceAppsConfig["oauth"]> {
  return {
    redirectUrl: () => "http://127.0.0.1:1/auth/callback/app",
    relayRedirectUrl: (service) =>
      `https://api.example/oauth/${service}/callback`,
    relayTokenUrl: (service) => `https://api.example/oauth/${service}/token`,
    store: memoryOAuthStore(),
  };
}

/** How a sign-in card a case puts up ends, as the app records it. */
export interface SignInOutcome {
  /** What the service or the app said, as the callback would record it. */
  detail: string;
  /** How it ended; absent for a sign-in that failed outright. */
  ended?: SignInEnd;
}

/**
 * Ends an app's sign-in the way the app's callback, its Cancel, or a lapsed
 * flow does: the connection is recorded as failed, and the chats waiting on
 * it are woken through the real app-event path.
 */
export async function endSignIn(
  slug: string,
  { detail, ended }: SignInOutcome,
): Promise<void> {
  await recordConnection(slug, {
    ...(ended ? { ended } : {}),
    error: detail,
    status: "failed",
  });
  await appChanged(slug, {
    detail,
    ...(ended ? { ended } : {}),
    event: "failed",
  });
}

/**
 * Answers an app's sign-in card the way the user does in the app: a sign-in
 * that connected as `account`, or Skip. The connection is recorded and the
 * chats waiting on it hear it through the real app-event path.
 */
export async function answerSignIn(
  slug: string,
  answer: "connected" | "declined",
  { account, appsDir }: { account: string; appsDir: string },
): Promise<void> {
  if (answer === "declined") {
    await recordConnection(slug, { status: "declined" });
    await appChanged(slug, { event: "declined" });
    return;
  }
  const loaded = await loadApp(AbsolutePathSchema.parse(appsDir), slug);
  if (loaded.isErr()) {
    throw new Error(`${slug}: ${loaded.error.message}`);
  }
  await recordConnection(slug, {
    account,
    connectedAt: Date.now(),
    manifestHash: loaded.value.manifestHash,
    status: "connected",
  });
  await appChanged(slug, { event: "connected" });
}

function memoryOAuthStore(): McpOAuthStore {
  const clients = new Map<string, OriginBound<OAuthClientInformationFull>>();
  const tokens = new Map<string, OriginBound<OAuthTokens>>();
  const states = new Map<string, string>();
  const verifiers = new Map<string, string>();
  const done = () => Promise.resolve();
  return {
    clearClientInformation: (slug) => {
      clients.delete(slug);
      return done();
    },
    clearTokens: (slug) => {
      tokens.delete(slug);
      return done();
    },
    clearTransient: (slug) => {
      states.delete(slug);
      verifiers.delete(slug);
      return done();
    },
    getClientInformation: (slug) => Promise.resolve(clients.get(slug)),
    getCodeVerifier: (slug) => Promise.resolve(verifiers.get(slug)),
    getState: (slug) => Promise.resolve(states.get(slug)),
    getTokens: (slug) => Promise.resolve(tokens.get(slug)),
    saveClientInformation: (slug, info) => {
      clients.set(slug, info);
      return done();
    },
    saveCodeVerifier: (slug, verifier) => {
      verifiers.set(slug, verifier);
      return done();
    },
    saveState: (slug, state) => {
      states.set(slug, state);
      return done();
    },
    saveTokens: (slug, saved) => {
      tokens.set(slug, saved);
      return done();
    },
  };
}
