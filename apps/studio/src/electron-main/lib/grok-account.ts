import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { is } from "@electron-toolkit/utils";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  GROK_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { safeStorage, shell } from "electron";
import Store from "electron-store";
import { type Actor, createActor, fromPromise, waitFor } from "xstate";
import { z } from "zod";

import { grantMachine, type RefreshOutcome } from "./chatgpt-grant";

/**
 * Sign in with a Grok subscription (SuperGrok, or X Premium through a linked
 * X account): xAI's device-code flow against the Grok CLI's public OAuth
 * client, which xAI lets agent hosts share, then the account's access token as
 * the bearer on xAI's API. One account at a time.
 *
 * Tokens never leave the main process; the gateway reads the current one
 * through the synthesized provider config.
 */

const log = logger.scope("grok-account");

const ISSUER = "https://auth.x.ai/oauth2";
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
/** How xAI tells which agent host a sign-in came from. */
const REFERRER = "instrument";
const API_BASE_URL = "https://api.x.ai/v1";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_REFRESH_BACKOFF_MS = 5 * 60 * 1000;
const EXPIRED_REFRESH_WAIT_MS = 10 * 1000;
const ACCOUNT_ID = AIProviderConfigIdSchema.parse(
  GROK_ACCOUNT_PROVIDER_CONFIG.id,
);

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
});

const DeviceCodeSchema = z.object({
  device_code: z.string(),
  expires_in: z.number().optional(),
  interval: z.number().optional(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
});

const AccountSchema = z.object({
  accessToken: z.string().optional(),
  email: z.string().optional(),
  expiresAt: z.number().optional(),
  name: z.string().optional(),
  refreshToken: z.string().optional(),
});
type Account = z.output<typeof AccountSchema>;

const StoreSchema = z.object({
  // Kept without tokens when the session ended elsewhere, so the card can say
  // so; signing out removes it.
  account: AccountSchema.optional(),
});
type StoreShape = z.output<typeof StoreSchema>;

let STORE: null | Store<StoreShape> = null;

export type GrokAccountState = "signed-in" | "signed-out";

export interface GrokAccountStatus {
  account?: { email?: string; label: string; state: GrokAccountState };
  /** The code to enter on xAI's page while a sign-in waits on it. */
  pending?: { userCode: string; verificationUri: string };
}

export interface GrokSignInResult {
  outcome: Extract<SignInOutcome, "canceled" | "declined" | "signed-in">;
}

let pending:
  | undefined
  | {
      controller: AbortController;
      userCode: string;
      verificationUri: string;
    };

export function grokAccountProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const account = getStore().get("account");
  if (!account?.accessToken) {
    return [];
  }
  if (isDue(account)) {
    grant().send({ type: "refreshDue" });
  }
  return [
    {
      ...GROK_ACCOUNT_PROVIDER_CONFIG,
      apiKey: account.accessToken,
      baseURL: API_BASE_URL,
      id: ACCOUNT_ID,
    },
  ];
}

export function grokAccountStatus(): GrokAccountStatus {
  const account = getStore().get("account");
  return {
    ...(account && {
      account: {
        email: account.email,
        label: account.email ?? account.name ?? "Grok account",
        state: account.refreshToken ? "signed-in" : "signed-out",
      },
    }),
    ...(pending && {
      pending: {
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
      },
    }),
  };
}

function getStore(): Store<StoreShape> {
  if (!STORE) {
    const defaults: StoreShape = {};
    STORE = new Store<StoreShape>({
      cwd: workspaceKeysDir(),
      defaults,
      deserialize: (value) => {
        try {
          const json = is.dev
            ? value
            : safeStorage.decryptString(Buffer.from(value, "base64"));
          return StoreSchema.parse(JSON.parse(json));
        } catch (error) {
          log.error("Failed to read the Grok account store", error);
          return defaults;
        }
      },
      fileExtension: is.dev ? "json" : "json.enc",
      name: "grok-account",
      serialize: (value) => {
        const json = JSON.stringify(value);
        if (is.dev) {
          return json;
        }
        // Without a keyring nothing is written, as the ChatGPT account's
        // store does: a sign-in then lasts until the app quits.
        if (!safeStorage.isEncryptionAvailable()) {
          log.error("Encryption is not available");
          return "";
        }
        return safeStorage.encryptString(json).toString("base64");
      },
    });
    STORE.onDidAnyChange(() => {
      publisher.publish("grok-account.updated", null);
      publisher.publish("provider-config.updated", null);
    });
  }
  return STORE;
}

/**
 * Writes `next` (or, with null, forgets the account) only when the stored
 * tokens are still the ones `spent` read, so an answer about tokens a sign-in
 * or sign-out replaced while it was out is dropped. Answers whether it wrote.
 */
function saveUnlessReplaced(
  spent: Account | undefined,
  next: Account | null,
): boolean {
  const stored = getStore().get("account");
  const unchanged =
    spent === undefined
      ? stored === undefined
      : stored !== undefined &&
        stored.refreshToken === spent.refreshToken &&
        stored.accessToken === spent.accessToken;
  if (!unchanged) {
    log.info("Grok grant changed while a request was out; dropping its answer");
    return false;
  }
  if (next) {
    getStore().set("account", next);
  } else {
    getStore().delete("account");
  }
  return true;
}

class TokenError extends Error {
  readonly code: string | undefined;
  constructor(
    readonly status: number,
    body: unknown,
  ) {
    const parsed = z
      .object({
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .safeParse(body);
    const code = parsed.success ? parsed.data.error : undefined;
    super(
      parsed.success && parsed.data.error_description
        ? parsed.data.error_description
        : `Grok token request failed (${String(status)}${code ? `, ${code}` : ""})`,
    );
    this.code = code;
  }
}

async function postForm(
  url: string,
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    body: new URLSearchParams(form),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal,
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TokenError(response.status, body);
  }
  return body;
}

function accountFromTokens(
  tokens: z.output<typeof TokenResponseSchema>,
  previous?: Account,
): Account {
  const claims = tokens.id_token ? readClaims(tokens.id_token) : undefined;
  return {
    accessToken: tokens.access_token,
    email: claims?.email ?? previous?.email,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    name: claims?.name ?? previous?.name,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
  };
}

/**
 * The ID token's name and email, read without checking its signature: it came
 * straight from xAI's token endpoint over TLS, and names the account only for
 * the card.
 */
function readClaims(idToken: string) {
  const payload = idToken.split(".")[1];
  if (!payload) {
    return undefined;
  }
  try {
    return z
      .object({ email: z.string().optional(), name: z.string().optional() })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  } catch {
    return undefined;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Start a sign-in: ask xAI for a device code, open its page in the browser
 * with the code filled in, and wait for the person to approve it there.
 * Asking again while one waits replaces it.
 */
export async function signInWithGrok(): Promise<GrokSignInResult> {
  pending?.controller.abort();
  const controller = new AbortController();
  const { signal } = controller;
  try {
    const device = DeviceCodeSchema.parse(
      await postForm(
        `${ISSUER}/device/code`,
        { client_id: CLIENT_ID, referrer: REFERRER, scope: SCOPE },
        signal,
      ),
    );
    const verificationUri =
      device.verification_uri_complete ?? device.verification_uri;
    pending = { controller, userCode: device.user_code, verificationUri };
    publisher.publish("grok-account.updated", null);
    await shell.openExternal(verificationUri);

    const deadline = Date.now() + (device.expires_in ?? 300) * 1000;
    let interval = Math.max(device.interval ?? 5, 1) * 1000;
    while (!signal.aborted) {
      await sleep(interval, signal);
      if (signal.aborted) {
        break;
      }
      if (Date.now() > deadline) {
        throw new Error("The Grok sign-in code expired. Try again.");
      }
      try {
        const tokens = TokenResponseSchema.parse(
          await postForm(
            `${ISSUER}/token`,
            {
              client_id: CLIENT_ID,
              device_code: device.device_code,
              grant_type: DEVICE_GRANT,
            },
            signal,
          ),
        );
        const account = accountFromTokens(tokens);
        if (!account.refreshToken) {
          throw new Error("Grok sign-in left the account without a session");
        }
        getStore().set("account", account);
        grant().send({ type: "signedIn" });
        return { outcome: "signed-in" };
      } catch (error) {
        if (!(error instanceof TokenError)) {
          throw error;
        }
        if (error.code === "authorization_pending") {
          continue;
        }
        if (error.code === "slow_down") {
          interval += 5000;
          continue;
        }
        if (
          error.code === "access_denied" ||
          error.code === "authorization_denied"
        ) {
          return { outcome: "declined" };
        }
        throw error;
      }
    }
    return { outcome: "canceled" };
  } catch (error) {
    if (signal.aborted) {
      return { outcome: "canceled" };
    }
    throw error;
  } finally {
    if (pending?.controller === controller) {
      pending = undefined;
      publisher.publish("grok-account.updated", null);
    }
  }
}

/** Give up on the sign-in waiting on the browser, if there is one. */
export function cancelGrokSignIn() {
  pending?.controller.abort();
}

const UNUSABLE_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "refresh_token_expired",
  "token_expired",
]);

let grantActor: Actor<typeof grantMachine> | undefined;

/**
 * The account's grant (chatgpt-grant.ts), which holds its refresh clock and
 * runs one refresh at a time, since the refresh token rotates.
 */
function grant(): Actor<typeof grantMachine> {
  if (grantActor) {
    return grantActor;
  }
  const actor = createActor(
    grantMachine.provide({
      actions: {
        endSession: (_, { accessToken }) => {
          const stored = getStore().get("account");
          if (stored?.accessToken === accessToken) {
            saveUnlessReplaced(stored, withoutTokens(stored));
          }
        },
      },
      actors: {
        refresh: fromPromise<RefreshOutcome, { id: string }>(() =>
          refreshTokens(),
        ),
        revoke: fromPromise<{ revoked: boolean }, { id: string }>(() => {
          // xAI publishes no revocation endpoint for the shared client, so
          // signing out forgets the tokens here.
          saveUnlessReplaced(getStore().get("account"), null);
          return Promise.resolve({ revoked: false });
        }),
      },
      delays: {
        refreshDelay: ({ context }) => {
          const account = getStore().get("account");
          if (!account) {
            return MAX_REFRESH_BACKOFF_MS;
          }
          const due = (account.expiresAt ?? 0) - REFRESH_MARGIN_MS;
          const backoff =
            context.failures === 0
              ? 0
              : Math.min(1000 * 2 ** context.failures, MAX_REFRESH_BACKOFF_MS);
          return Math.max(due - Date.now(), 1000, backoff);
        },
      },
      guards: {
        hasSession: () => Boolean(getStore().get("account")?.refreshToken),
        isDue: () => isDue(getStore().get("account")),
      },
    }),
    { input: { id: ACCOUNT_ID } },
  );
  grantActor = actor;
  actor.subscribe({
    complete: () => {
      if (grantActor === actor) {
        grantActor = undefined;
      }
    },
  });
  actor.start();
  return actor;
}

function isDue(account: Account | undefined): boolean {
  return (
    account?.refreshToken !== undefined &&
    (account.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS
  );
}

function withoutTokens(account: Account): Account {
  return { email: account.email, name: account.name };
}

async function refreshTokens(): Promise<RefreshOutcome> {
  const account = getStore().get("account");
  if (!account?.refreshToken) {
    return "ended";
  }
  try {
    const tokens = TokenResponseSchema.parse(
      await postForm(`${ISSUER}/token`, {
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      }),
    );
    return saveUnlessReplaced(account, accountFromTokens(tokens, account))
      ? "refreshed"
      : "replaced";
  } catch (error) {
    if (
      error instanceof TokenError &&
      UNUSABLE_REFRESH_CODES.has(error.code ?? "")
    ) {
      log.warn("Grok session ended; signing in again is required");
      return saveUnlessReplaced(account, withoutTokens(account))
        ? "ended"
        : "replaced";
    }
    log.warn("Grok token refresh failed", error);
    return "failed";
  }
}

/**
 * Replace the access token if it has already expired, and wait for it, so a
 * request right after a long sleep or a cold launch carries a good one. An id
 * that names another provider's config waits on nothing.
 */
export async function refreshExpiredGrokTokens(
  accountId?: string,
): Promise<void> {
  if (accountId !== undefined && accountId !== ACCOUNT_ID) {
    return;
  }
  const account = getStore().get("account");
  if (!account?.refreshToken || (account.expiresAt ?? 0) > Date.now()) {
    return;
  }
  const actor = grant();
  actor.send({ type: "refreshDue" });
  await waitFor(
    actor,
    (snapshot) => !snapshot.matches({ active: "refreshing" }),
    {
      timeout: EXPIRED_REFRESH_WAIT_MS,
    },
  ).catch(() => {
    // A refresh still running past its wait is left to finish on its own.
  });
}

/** Keep the token fresh; call once at startup. */
export function scheduleGrokRefresh(): void {
  if (getStore().get("account")) {
    grant();
  }
}

/** Catch the token up after the machine wakes; see chatgpt-account.ts. */
export function refreshGrokAfterWake(): void {
  if (getStore().get("account")) {
    grant().send({ type: "woke" });
  }
}

export async function signOutOfGrok(): Promise<void> {
  if (!getStore().get("account")) {
    return;
  }
  const actor = grant();
  actor.send({ type: "signOut" });
  await waitFor(actor, (snapshot) => snapshot.status === "done");
}
