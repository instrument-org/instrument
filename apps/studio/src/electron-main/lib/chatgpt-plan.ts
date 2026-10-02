import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { is } from "@electron-toolkit/utils";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import { APP_NAME, CHATGPT_PLAN_PROVIDER_CONFIG } from "@instrument-org/shared";
import { safeStorage, shell } from "electron";
import Store from "electron-store";
import {
  createHash,
  createPublicKey,
  type JsonWebKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { z } from "zod";

/**
 * Sign in with ChatGPT for the user's own plan: an OAuth public client that
 * registers this installation as an agent host on first sign-in, then sends
 * the account's access token as the bearer on Responses API requests. Tokens
 * never leave the main process; the gateway reads the current one through the
 * synthesized provider config.
 */

const log = logger.scope("chatgpt-plan");

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const RESOURCE = "https://api.openai.com/v1";
const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  PLAN_SCOPE,
];
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const TokenResponseSchema = z.object({
  access_token: z.string(),
  earliest_refresh_at: z.number().optional(),
  expires_in: z.number(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

const AccountSchema = z.object({
  accessToken: z.string().optional(),
  clientId: z.string(),
  // Unix milliseconds before which a refresh is refused.
  earliestRefreshAt: z.number().optional(),
  email: z.string().optional(),
  expiresAt: z.number().optional(),
  idToken: z.string().optional(),
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  subject: z.string(),
});
type Account = z.output<typeof AccountSchema>;

const StoreSchema = z.object({
  // Accounts are keyed by the validated ID-token subject. A signed-out
  // account keeps its issued client id so signing in again reuses it.
  accounts: z.record(z.string(), AccountSchema).default({}),
  activeSubject: z.string().optional(),
  // One per installation, chosen before the first sign-in and never derived
  // from the account.
  hostId: z.string().optional(),
});
type StoreShape = z.output<typeof StoreSchema>;

let STORE: null | Store<StoreShape> = null;

interface PendingSignIn {
  deliver: (params: URLSearchParams) => void;
  promise: Promise<ChatGPTPlanStatus>;
  supersede: () => void;
}

let pendingSignIn: null | PendingSignIn = null;

const VERIFY_EVERY_MS = 30 * 1000;
let lastVerifiedAt = 0;

export type ChatGPTPlanStatus =
  | { email?: string; state: "plan-disabled" }
  | { email?: string; state: "signed-in" }
  | { state: "signed-out" }
  | { state: "signing-in" };

/**
 * The provider config for the active account, when it may use its plan. The
 * token in it is whatever is current; one close to expiring starts a refresh
 * so the next request carries the replacement.
 */
export function chatGPTPlanProviderConfig():
  | AIGatewayProviderConfig.Type
  | undefined {
  const account = activeAccount();
  if (!account?.accessToken || !account.scopes.includes(PLAN_SCOPE)) {
    return undefined;
  }
  if ((account.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS) {
    void refreshActiveAccount();
  }
  return { ...CHATGPT_PLAN_PROVIDER_CONFIG, apiKey: account.accessToken };
}

export function chatGPTPlanStatus(): ChatGPTPlanStatus {
  return pendingSignIn ? { state: "signing-in" } : accountStatus();
}

/**
 * Whether the active account's session still stands, asked of the API. A
 * disconnect in ChatGPT's settings reaches us only as a refused request, so
 * the settings card asks when it opens rather than showing a session that
 * ended elsewhere as signed in.
 */
export async function verifyActiveAccount(): Promise<void> {
  let account = activeAccount();
  if (!account?.accessToken || Date.now() - lastVerifiedAt < VERIFY_EVERY_MS) {
    return;
  }
  lastVerifiedAt = Date.now();
  // A refused expired token says nothing about the session, which the
  // refresh token still holds, so an old one is replaced before asking. A
  // refresh that could not finish leaves the question for the next time.
  if ((account.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS) {
    await refreshActiveAccount();
    account = activeAccount();
    if (!account?.accessToken || (account.expiresAt ?? 0) <= Date.now()) {
      return;
    }
  }
  try {
    const response = await fetch(`${RESOURCE}/models`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    if (response.status === 401) {
      log.warn("ChatGPT refused the session; signing in again is required");
      saveAccount(withoutTokens(account), { activate: false });
    }
  } catch (error) {
    // Offline says nothing about the session.
    log.warn("Couldn't check the ChatGPT session", error);
  }
}

// The account's own state, apart from a sign-in in flight: what a sign-in
// that just finished reports, while it is still the one pending.
function accountStatus(): ChatGPTPlanStatus {
  const account = activeAccount();
  if (!account?.refreshToken) {
    return { state: "signed-out" };
  }
  return account.scopes.includes(PLAN_SCOPE)
    ? { email: account.email, state: "signed-in" }
    : { email: account.email, state: "plan-disabled" };
}

function activeAccount(): Account | undefined {
  const store = getStore();
  const subject = store.get("activeSubject");
  return subject ? store.get("accounts")[subject] : undefined;
}

function getStore(): Store<StoreShape> {
  if (!STORE) {
    const defaults: StoreShape = { accounts: {} };
    STORE = new Store<StoreShape>({
      cwd: workspaceSettingsDir(),
      defaults,
      deserialize: (value) => {
        try {
          const json = is.dev
            ? value
            : safeStorage.decryptString(Buffer.from(value, "base64"));
          return StoreSchema.parse(JSON.parse(json));
        } catch (error) {
          log.error("Failed to read the ChatGPT plan store", error);
          return defaults;
        }
      },
      fileExtension: is.dev ? "json" : "json.enc",
      name: "chatgpt-plan",
      serialize: (value) => {
        const json = JSON.stringify(value);
        if (is.dev) {
          return json;
        }
        // Where there is no keyring to encrypt with (a Linux desktop without
        // one, or CI), nothing is written, as the session and provider stores
        // do: the store is made, and writes its defaults, on the first read at
        // boot, so throwing here kept the app from opening at all. A sign-in
        // then lasts until the app quits.
        if (!safeStorage.isEncryptionAvailable()) {
          log.error("Encryption is not available");
          return "";
        }
        return safeStorage.encryptString(json).toString("base64");
      },
    });
    STORE.onDidAnyChange(() => {
      publisher.publish("chatgpt-plan.updated", null);
      publisher.publish("provider-config.updated", null);
    });
  }
  return STORE;
}

function hostId(): string {
  const store = getStore();
  const existing = store.get("hostId");
  if (existing) {
    return existing;
  }
  const created = `urn:uuid:${randomUUID()}`;
  store.set("hostId", created);
  return created;
}

function saveAccount(account: Account, { activate }: { activate: boolean }) {
  const store = getStore();
  store.set("accounts", {
    ...store.get("accounts"),
    [account.subject]: account,
  });
  if (activate) {
    store.set("activeSubject", account.subject);
  }
}

/**
 * Where the auth callback server takes ChatGPT's redirect. OpenAI fixes the
 * scheme, host and path of the redirect; only the port may vary.
 */
export const CHATGPT_CALLBACK_PATH = "/auth/callback";

class TokenError extends Error {
  readonly code: string | undefined;
  constructor(
    readonly status: number,
    body: unknown,
  ) {
    const parsed = z
      .object({
        error: z
          .union([z.string(), z.object({ code: z.string().optional() })])
          .optional(),
        error_description: z.string().optional(),
      })
      .safeParse(body);
    const error = parsed.success ? parsed.data.error : undefined;
    const code = typeof error === "string" ? error : error?.code;
    super(
      `ChatGPT token request failed (${String(status)}${code ? `, ${code}` : ""})`,
    );
    this.code = code;
  }
}

/**
 * Hand ChatGPT's redirect to the sign-in waiting for it. Resolves once the
 * sign-in has finished, so the page the browser lands on can say how it went;
 * undefined when no sign-in is waiting.
 */
export function receiveChatGPTCallback(
  params: URLSearchParams,
): Promise<ChatGPTPlanStatus> | undefined {
  if (!pendingSignIn) {
    return undefined;
  }
  pendingSignIn.deliver(params);
  return pendingSignIn.promise;
}

/**
 * Start a sign-in in the user's browser. Asking again while one is waiting
 * replaces it, so a tab that was closed or never opened is got past by
 * continuing again rather than by canceling first.
 */
export function signInWithChatGPT({
  callbackPort,
}: {
  callbackPort: number;
}): Promise<ChatGPTPlanStatus> {
  pendingSignIn?.supersede();
  const controls: {
    deliver: (params: URLSearchParams) => void;
    supersede: () => void;
  } = { deliver: noop, supersede: noop };
  // Null when a newer sign-in took this one's place.
  const received = new Promise<null | URLSearchParams>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("ChatGPT sign-in timed out"));
    }, SIGN_IN_TIMEOUT_MS);
    controls.deliver = (params) => {
      clearTimeout(timeout);
      resolve(params);
    };
    controls.supersede = () => {
      clearTimeout(timeout);
      resolve(null);
    };
  });
  const entry: PendingSignIn = {
    ...controls,
    promise: runSignIn({
      received,
      redirectURI: `http://127.0.0.1:${String(callbackPort)}${CHATGPT_CALLBACK_PATH}`,
    }).finally(() => {
      if (pendingSignIn === entry) {
        pendingSignIn = null;
      }
      publisher.publish("chatgpt-plan.updated", null);
    }),
  };
  pendingSignIn = entry;
  publisher.publish("chatgpt-plan.updated", null);
  return entry.promise;
}

function accountFromTokens(
  tokens: z.output<typeof TokenResponseSchema>,
  identity: { clientId: string; email?: string; subject: string },
  previous?: Account,
): Account {
  const now = Date.now();
  return {
    accessToken: tokens.access_token,
    clientId: identity.clientId,
    earliestRefreshAt:
      tokens.earliest_refresh_at === undefined
        ? undefined
        : tokens.earliest_refresh_at * 1000,
    email: identity.email ?? previous?.email,
    expiresAt: now + tokens.expires_in * 1000,
    idToken: tokens.id_token ?? previous?.idToken,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    scopes: tokens.scope ? tokens.scope.split(" ") : (previous?.scopes ?? []),
    subject: identity.subject,
  };
}

// The account to sign back in to: the active one, or else the one most
// recently signed out of on this host.
function lastAccount(): Account | undefined {
  return activeAccount() ?? Object.values(getStore().get("accounts"))[0];
}

function noop() {
  // Stands in until the sign-in promise hands over its own.
}

async function postToken(form: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams(form),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TokenError(response.status, body);
  }
  return TokenResponseSchema.parse(body);
}

async function runSignIn({
  received,
  redirectURI,
}: {
  received: Promise<null | URLSearchParams>;
  redirectURI: string;
}): Promise<ChatGPTPlanStatus> {
  const returning = lastAccount();
  const clientId = returning?.clientId ?? DYNAMIC_CLIENT_ID;
  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ext_agent_host_id: hostId(),
    nonce,
    redirect_uri: redirectURI,
    resource: RESOURCE,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
  });
  if (clientId === DYNAMIC_CLIENT_ID) {
    params.set("agent_name_hint", APP_NAME);
  } else if (returning?.email) {
    params.set("login_hint", returning.email);
  }
  if (returning?.scopes.length && !returning.scopes.includes(PLAN_SCOPE)) {
    // Asked again after the plan was declined: show the consent screen.
    params.set("prompt", "consent");
  }
  // Opened directly rather than through openExternal, which logs the URL.
  await shell.openExternal(`${AUTHORIZE_URL}?${params.toString()}`);

  const callback = await received;
  if (!callback) {
    return accountStatus();
  }
  if (callback.get("state") !== state) {
    throw new Error("The sign-in response did not match this attempt");
  }
  const error = callback.get("error");
  if (error) {
    if (error === "access_denied") {
      return accountStatus();
    }
    throw new Error(
      `ChatGPT sign-in failed: ${callback.get("error_description") ?? error}`,
    );
  }
  const code = callback.get("code");
  if (!code) {
    throw new Error("The sign-in response carried no authorization code");
  }
  const callbackClientId = callback.get("client_id");
  let issuedClientId = clientId;
  if (clientId === DYNAMIC_CLIENT_ID) {
    if (!callbackClientId) {
      throw new Error("ChatGPT did not finish registering this app");
    }
    issuedClientId = callbackClientId;
  } else if (callbackClientId && callbackClientId !== clientId) {
    throw new Error("The sign-in came back for a different registration");
  }

  const tokens = await postToken({
    client_id: issuedClientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectURI,
    resource: RESOURCE,
  });
  if (!tokens.id_token) {
    throw new Error("ChatGPT returned no ID token");
  }
  const claims = await validateIdToken(tokens.id_token, {
    clientId: issuedClientId,
    nonce,
  });
  if (
    returning &&
    clientId !== DYNAMIC_CLIENT_ID &&
    claims.sub !== returning.subject
  ) {
    throw new Error("Signed in to a different ChatGPT account");
  }

  saveAccount(
    accountFromTokens(tokens, {
      clientId: issuedClientId,
      email: claims.email,
      subject: claims.sub,
    }),
    { activate: true },
  );
  scheduleRefresh();
  return accountStatus();
}

const UNUSABLE_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "token_expired",
]);

let refreshing: null | Promise<void> = null;
let refreshTimer: NodeJS.Timeout | undefined;
/** Refreshes that failed in a row, for how long to wait before the next. */
let failedRefreshes = 0;
/** The longest wait between refreshes that keep failing. */
const MAX_REFRESH_BACKOFF_MS = 5 * 60 * 1000;

/** Keep the active account's token fresh; call once at startup. */
export function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  const account = activeAccount();
  if (!account?.refreshToken) {
    return;
  }
  const due = Math.max(
    (account.expiresAt ?? 0) - REFRESH_MARGIN_MS,
    account.earliestRefreshAt ?? 0,
  );
  // A refresh that failed leaves the token as due as it was, so without a
  // growing wait the next try would come every second for as long as the
  // network or the server is down.
  const backoff =
    failedRefreshes === 0
      ? 0
      : Math.min(1000 * 2 ** failedRefreshes, MAX_REFRESH_BACKOFF_MS);
  refreshTimer = setTimeout(
    () => void refreshActiveAccount(),
    Math.max(due - Date.now(), 1000, backoff),
  );
  refreshTimer.unref();
}

/**
 * Catch the token up after the machine wakes. The refresh timer counts on a
 * clock that stops while the machine sleeps, so after a sleep longer than the
 * token's hour it is still waiting for a token that has already expired, and
 * the first request after waking would carry it. A token still good is left
 * to a timer counted again from now.
 */
export function refreshAfterWake(): void {
  const account = activeAccount();
  if (!account?.refreshToken) {
    return;
  }
  if ((account.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS) {
    void refreshActiveAccount();
  } else {
    scheduleRefresh();
  }
}

export async function signOutOfChatGPT(): Promise<{ revoked: boolean }> {
  const account = activeAccount();
  if (!account) {
    return { revoked: true };
  }
  clearTimeout(refreshTimer);
  let revoked = !account.refreshToken;
  if (account.refreshToken) {
    try {
      const discovery = await openIdConfiguration();
      const response = await fetch(discovery.revocation_endpoint, {
        body: new URLSearchParams({
          client_id: account.clientId,
          token: account.refreshToken,
          token_type_hint: "refresh_token",
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      revoked = response.ok;
    } catch (error) {
      log.warn("ChatGPT token revocation failed", error);
    }
  }
  saveAccount(withoutTokens(account), { activate: false });
  getStore().delete("activeSubject");
  return { revoked };
}

async function doRefresh(): Promise<void> {
  const account = activeAccount();
  if (!account?.refreshToken) {
    return;
  }
  if (account.earliestRefreshAt && Date.now() < account.earliestRefreshAt) {
    return;
  }
  try {
    const tokens = await postToken({
      client_id: account.clientId,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      resource: RESOURCE,
    });
    saveAccount(accountFromTokens(tokens, account, account), {
      activate: false,
    });
    failedRefreshes = 0;
  } catch (error) {
    if (
      error instanceof TokenError &&
      UNUSABLE_REFRESH_CODES.has(error.code ?? "")
    ) {
      log.warn("ChatGPT session ended; signing in again is required");
      saveAccount(withoutTokens(account), { activate: false });
      return;
    }
    // A network or server failure keeps the credentials for the next try.
    failedRefreshes += 1;
    log.warn("ChatGPT token refresh failed", error);
  }
}

// One refresh at a time: the refresh token rotates, so two racing requests
// would spend it twice and lose the session.
function refreshActiveAccount(): Promise<void> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
    scheduleRefresh();
  });
  return refreshing;
}

function withoutTokens(account: Account): Account {
  return {
    clientId: account.clientId,
    email: account.email,
    // Kept so a later sign-in knows whether the plan was declined last time.
    scopes: account.scopes,
    subject: account.subject,
  };
}

const DiscoverySchema = z.object({
  issuer: z.string(),
  jwks_uri: z.string(),
  revocation_endpoint: z.string(),
});

let discoveryCache: null | Promise<z.output<typeof DiscoverySchema>> = null;

function openIdConfiguration() {
  discoveryCache ??= fetch(DISCOVERY_URL)
    .then((response) => response.json())
    .then((body) => DiscoverySchema.parse(body))
    .catch((error: unknown) => {
      discoveryCache = null;
      throw error;
    });
  return discoveryCache;
}

const IdTokenClaimsSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.string().optional(),
  exp: z.number(),
  iss: z.string(),
  nonce: z.string().optional(),
  sub: z.string(),
});

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

async function validateIdToken(
  token: string,
  { clientId, nonce }: { clientId: string; nonce: string },
) {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Malformed ID token");
  }
  const header = z
    .object({ alg: z.string(), kid: z.string().optional() })
    .parse(JSON.parse(Buffer.from(headerPart, "base64url").toString()));
  if (header.alg !== "RS256") {
    throw new Error(`Unexpected ID token algorithm ${header.alg}`);
  }
  const discovery = await openIdConfiguration();
  const jwks = z
    .object({ keys: z.array(z.looseObject({ kid: z.string().optional() })) })
    .parse(await fetch(discovery.jwks_uri).then((response) => response.json()));
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new Error("No signing key matches the ID token");
  }
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    // A JWKS entry, which is the JWK shape node's key import reads.
    createPublicKey({ format: "jwk", key: jwk as JsonWebKey }),
    Buffer.from(signaturePart, "base64url"),
  );
  if (!valid) {
    throw new Error("The ID token's signature is invalid");
  }
  const claims = IdTokenClaimsSchema.parse(
    JSON.parse(Buffer.from(payloadPart, "base64url").toString()),
  );
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== discovery.issuer && claims.iss !== ISSUER) {
    throw new Error("The ID token came from an unexpected issuer");
  }
  if (!audiences.includes(clientId)) {
    throw new Error("The ID token was issued to a different client");
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new Error("The ID token has expired");
  }
  if (claims.nonce !== nonce) {
    throw new Error("The ID token does not match this sign-in");
  }
  return claims;
}
