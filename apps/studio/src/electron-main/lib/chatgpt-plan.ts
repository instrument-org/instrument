import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { is } from "@electron-toolkit/utils";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  APP_NAME,
  CHATGPT_PLAN_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
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
import { ulid } from "ulid";
import { type Actor, createActor, fromPromise, waitFor } from "xstate";
import { z } from "zod";

import { grantMachine, type RefreshOutcome } from "./chatgpt-grant";
import {
  BUILT_IN_SIGN_IN_SETUP,
  fetchSignInSetup,
  type SignInSetup,
  SignInSetupSchema,
} from "./chatgpt-sign-in-setup";

/**
 * Sign in with ChatGPT for the user's own plans: an OAuth public client that
 * registers this installation as an agent host once per ChatGPT account, then
 * sends that account's access token as the bearer on Responses API requests.
 *
 * Each sign-in is a registration: one ChatGPT user in one workspace, with the
 * client id OpenAI issued for it and its own tokens. A person can hold several
 * (a personal plan and a work one, on the same email or not), and each is its
 * own provider config, so a chat runs on the account its model names. Nothing
 * here moves a request from one account to another: OpenAI's Sign in with
 * ChatGPT Terms forbid rotating accounts to get past usage limits.
 *
 * Tokens never leave the main process; the gateway reads the current ones
 * through the synthesized provider configs.
 */

const log = logger.scope("chatgpt-plan");

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

const RegistrationSchema = z.object({
  accessToken: z.string().optional(),
  /** Unix milliseconds of the first sign-in, which orders the accounts. */
  addedAt: z.number(),
  /** Issued by OpenAI for this user and workspace on this host. */
  clientId: z.string(),
  // Unix milliseconds before which a refresh is refused.
  earliestRefreshAt: z.number().optional(),
  email: z.string().optional(),
  expiresAt: z.number().optional(),
  /** Ours, and the provider config id its models' URIs carry. */
  id: AIProviderConfigIdSchema,
  name: z.string().optional(),
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  /** The validated ID-token subject, which two workspaces of one user share. */
  subject: z.string(),
});
type Registration = z.output<typeof RegistrationSchema>;

const StoreSchema = z.object({
  // One per installation, chosen before the first sign-in and never derived
  // from an account.
  hostId: z.string().optional(),
  // Keyed by `id`. A registration whose session ended elsewhere stays, without
  // tokens, so signing in to it again reuses its client id; signing out
  // removes it.
  registrations: z.record(z.string(), RegistrationSchema).default({}),
  // The last setup our API served, kept so refreshes and checks follow it
  // after a restart. One that no longer validates is dropped rather than
  // failing the whole store.
  signInSetup: SignInSetupSchema.optional().catch(undefined),
});
type StoreShape = z.output<typeof StoreSchema>;

let STORE: null | Store<StoreShape> = null;

interface PendingSignIn {
  deliver: (params: URLSearchParams) => void;
  promise: Promise<ChatGPTSignInResult>;
  // The `state` the authorize URL carried; a redirect without it is not this
  // sign-in's.
  state: string;
  supersede: () => void;
}

let pendingSignIn: null | PendingSignIn = null;

const VERIFY_EVERY_MS = 30 * 1000;
const lastVerifiedAt = new Map<string, number>();

export type ChatGPTAccountState = "plan-disabled" | "signed-in" | "signed-out";

export interface ChatGPTAccountStatus {
  email?: string;
  id: string;
  /** What the account is called wherever accounts sit side by side. */
  label: string;
  state: ChatGPTAccountState;
}

export interface ChatGPTPlanStatus {
  /** In the order they were first signed in to. */
  accounts: ChatGPTAccountStatus[];
  signingIn: boolean;
}

/**
 * How a sign-in ended, and the account it landed on when it signed in. A
 * sign-in that went wrong rejects instead, with what went wrong.
 */
export interface ChatGPTSignInResult {
  account?: ChatGPTAccountStatus;
  outcome: Exclude<SignInOutcome, "expired" | "failed">;
}

/**
 * A provider config for each account that may use its plan. The token in each
 * is whatever is current; one close to expiring starts a refresh so the next
 * request carries the replacement.
 */
export function chatGPTPlanProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const all = registrations();
  return all.flatMap((registration) => {
    if (
      !registration.accessToken ||
      !registration.scopes.includes(currentSetup().planScope)
    ) {
      return [];
    }
    if (isDue(registration)) {
      grantOf(registration.id).send({ type: "refreshDue" });
    }
    return [
      {
        ...CHATGPT_PLAN_PROVIDER_CONFIG,
        apiKey: registration.accessToken,
        cacheIdentifier: `chatgpt-plan-${registration.id}`,
        displayName:
          all.length === 1
            ? CHATGPT_PLAN_PROVIDER_CONFIG.displayName
            : labelFor(registration, all),
        id: registration.id,
      },
    ];
  });
}

/**
 * Who the first signed-in ChatGPT account belongs to, as its ID token named
 * them: the email, and the name when the token carried one. Undefined while
 * no account is signed in.
 */
export function chatGPTPlanUser():
  | undefined
  | { email: string; name?: string } {
  const registration = registrations().find(
    (candidate) => candidate.refreshToken && candidate.email,
  );
  return registration?.email
    ? { email: registration.email, name: registration.name }
    : undefined;
}

export function chatGPTPlanStatus(): ChatGPTPlanStatus {
  const all = registrations();
  return {
    accounts: all.map((registration) => accountStatus(registration, all)),
    signingIn: pendingSignIn !== null,
  };
}

/**
 * Whether each account's session still stands, asked of the API. A
 * disconnect in ChatGPT's settings reaches us only as a refused request, so
 * the settings card asks when it opens rather than showing a session that
 * ended elsewhere as signed in.
 */
export async function verifyAccounts(): Promise<void> {
  await Promise.all(
    registrations().map((registration) => verifyAccount(registration.id)),
  );
}

async function verifyAccount(id: string): Promise<void> {
  let registration = registrationById(id);
  if (
    !registration?.accessToken ||
    Date.now() - (lastVerifiedAt.get(id) ?? 0) < VERIFY_EVERY_MS
  ) {
    return;
  }
  lastVerifiedAt.set(id, Date.now());
  // A refused expired token says nothing about the session, which the
  // refresh token still holds, so an old one is replaced before asking. A
  // refresh that could not finish leaves the question for the next time.
  if (isDue(registration)) {
    const grant = grantOf(id);
    grant.send({ type: "refreshDue" });
    await waitFor(
      grant,
      (snapshot) => !snapshot.matches({ active: "refreshing" }),
    );
    registration = registrationById(id);
    if (
      !registration?.accessToken ||
      (registration.expiresAt ?? 0) <= Date.now()
    ) {
      return;
    }
  }
  try {
    const response = await fetch(`${currentSetup().resource}/models`, {
      headers: { Authorization: `Bearer ${registration.accessToken}` },
    });
    if (response.status === 401) {
      log.warn("ChatGPT refused a session; signing in again is required");
      grantOf(id).send({
        accessToken: registration.accessToken,
        type: "sessionRefused",
      });
    }
  } catch (error) {
    // Offline says nothing about the session.
    log.warn("Couldn't check the ChatGPT session", error);
  }
}

function accountStatus(
  registration: Registration,
  all: Registration[],
): ChatGPTAccountStatus {
  return {
    email: registration.email,
    id: registration.id,
    label: labelFor(registration, all),
    state: !registration.refreshToken
      ? "signed-out"
      : registration.scopes.includes(currentSetup().planScope)
        ? "signed-in"
        : "plan-disabled",
  };
}

/**
 * The account's email, numbered from the second registration on that email:
 * one ChatGPT user registers once per workspace, and nothing OpenAI returns
 * names the workspace.
 */
export function labelFor(
  registration: Pick<Registration, "email" | "id">,
  all: Pick<Registration, "email" | "id">[],
): string {
  const email = registration.email ?? "ChatGPT account";
  const sameEmail = all.filter(
    (candidate) => candidate.email === registration.email,
  );
  const position = sameEmail.findIndex(
    (candidate) => candidate.id === registration.id,
  );
  return position > 0 ? `${email} (${String(position + 1)})` : email;
}

function registrations(): Registration[] {
  return Object.values(getStore().get("registrations")).toSorted(
    (a, b) => a.addedAt - b.addedAt,
  );
}

function registrationById(id: string): Registration | undefined {
  return getStore().get("registrations")[id];
}

function getStore(): Store<StoreShape> {
  if (!STORE) {
    const defaults: StoreShape = { registrations: {} };
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

/** The setup to follow now: the last one our API served, or the built-in one. */
function currentSetup(): SignInSetup {
  return getStore().get("signInSetup") ?? BUILT_IN_SIGN_IN_SETUP;
}

/**
 * Asks our API for the current setup before a sign-in, keeping what it serves
 * for later refreshes. When it cannot answer, the last one it served stands.
 */
async function loadSignInSetup(): Promise<SignInSetup> {
  const fetched = await fetchSignInSetup();
  if (fetched) {
    getStore().set("signInSetup", fetched);
  }
  return fetched ?? currentSetup();
}

/**
 * The one writer of the registrations. Writes `next` (or, with null, forgets
 * the registration) only when the stored one is still `spent`, the one the
 * caller read before it went out: undefined for an account not stored yet.
 * Otherwise the grant was replaced while the request was out (a sign-out
 * removed it, or a sign-in brought new tokens), the answer describes a grant
 * that is gone, and writing it would bring back tokens the user signed out of
 * or overwrite the ones they just signed in with. Answers whether it wrote.
 */
function saveUnlessReplaced(
  spent: Registration | undefined,
  next: null | Registration,
): boolean {
  const id = spent?.id ?? next?.id;
  if (id === undefined) {
    return false;
  }
  const stored = registrationById(id);
  const unchanged =
    spent === undefined
      ? stored === undefined
      : stored !== undefined &&
        stored.refreshToken === spent.refreshToken &&
        stored.accessToken === spent.accessToken;
  if (!unchanged) {
    log.info(
      "ChatGPT grant changed while a request was out; dropping its answer",
    );
    return false;
  }
  const store = getStore();
  const { [id]: _replaced, ...rest } = store.get("registrations");
  store.set("registrations", next ? { ...rest, [id]: next } : rest);
  return true;
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
 * undefined when no sign-in is waiting or the redirect carries another
 * `state`. Any page or local process can reach the callback port, so a
 * redirect that is not this sign-in's is turned away and the sign-in keeps
 * waiting for its own.
 */
export function receiveChatGPTCallback(
  params: URLSearchParams,
): Promise<ChatGPTSignInResult> | undefined {
  if (!pendingSignIn || params.get("state") !== pendingSignIn.state) {
    return undefined;
  }
  pendingSignIn.deliver(params);
  return pendingSignIn.promise;
}

/**
 * Start a sign-in in the user's browser: to the account `accountId` names,
 * which reuses its registration, or else to whichever account the browser
 * signs in to, which registers it unless this host already has. Asking again
 * while one is waiting replaces it, so a tab that was closed or never opened
 * is got past by continuing again rather than by canceling first.
 */
export function signInWithChatGPT({
  accountId,
  callbackPort,
}: {
  accountId?: string;
  callbackPort: number;
}): Promise<ChatGPTSignInResult> {
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
  const target = accountId ? registrationById(accountId) : undefined;
  const grant = target ? grantOf(target.id) : undefined;
  grant?.send({ type: "signInStarted" });
  const state = base64url(randomBytes(32));
  const entry: PendingSignIn = {
    ...controls,
    promise: runSignIn({
      received,
      redirectURI: `http://127.0.0.1:${String(callbackPort)}${CHATGPT_CALLBACK_PATH}`,
      state,
      target,
    }).finally(() => {
      // A sign-in that landed has told its grant; this one ended without.
      grant?.send({ type: "signInEnded" });
      if (pendingSignIn === entry) {
        pendingSignIn = null;
      }
      publisher.publish("chatgpt-plan.updated", null);
    }),
    state,
  };
  pendingSignIn = entry;
  publisher.publish("chatgpt-plan.updated", null);
  return entry.promise;
}

/**
 * Give up on the sign-in waiting on the browser, if there is one: it settles
 * as canceled, and the browser's redirect, should it still come, is refused.
 */
export function cancelChatGPTSignIn() {
  pendingSignIn?.supersede();
}

function registrationFromTokens(
  tokens: z.output<typeof TokenResponseSchema>,
  identity: Pick<Registration, "addedAt" | "clientId" | "id" | "subject"> &
    Pick<Partial<Registration>, "email" | "name">,
  previous?: Registration,
): Registration {
  const now = Date.now();
  return {
    accessToken: tokens.access_token,
    addedAt: identity.addedAt,
    clientId: identity.clientId,
    earliestRefreshAt:
      tokens.earliest_refresh_at === undefined
        ? undefined
        : tokens.earliest_refresh_at * 1000,
    email: identity.email ?? previous?.email,
    expiresAt: now + tokens.expires_in * 1000,
    id: identity.id,
    name: identity.name ?? previous?.name,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    scopes: tokens.scope ? tokens.scope.split(" ") : (previous?.scopes ?? []),
    subject: identity.subject,
  };
}

function noop() {
  // Stands in until the sign-in promise hands over its own.
}

async function postToken(tokenUrl: string, form: Record<string, string>) {
  const response = await fetch(tokenUrl, {
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
  state,
  target,
}: {
  received: Promise<null | URLSearchParams>;
  redirectURI: string;
  state: string;
  target: Registration | undefined;
}): Promise<ChatGPTSignInResult> {
  // A sign-in given up while the setup was on its way opens no browser. The
  // timeout's rejection is caught here as well as below, where it is reported.
  const setup = await Promise.race([
    loadSignInSetup(),
    received.then(
      () => undefined,
      () => undefined,
    ),
  ]);
  if (!setup) {
    return { outcome: "canceled" };
  }
  const clientId = target?.clientId ?? setup.dynamicClientId;
  const nonce = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const params = new URLSearchParams({
    ...setup.authorizeParams,
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ext_agent_host_id: hostId(),
    nonce,
    redirect_uri: redirectURI,
    resource: setup.resource,
    response_type: "code",
    scope: setup.scopes.join(" "),
    state,
  });
  if (clientId === setup.dynamicClientId) {
    params.set("agent_name_hint", APP_NAME);
  } else if (target?.email) {
    params.set("login_hint", target.email);
  }
  if (target?.scopes.length && !target.scopes.includes(setup.planScope)) {
    // Asked again after the plan was declined: show the consent screen.
    params.set("prompt", "consent");
  }
  // Opened directly rather than through openExternal, which logs the URL.
  await shell.openExternal(`${setup.authorizeUrl}?${params.toString()}`);

  const callback = await received;
  if (!callback) {
    return { outcome: "canceled" };
  }
  const error = callback.get("error");
  if (error) {
    if (error === "access_denied") {
      return { outcome: "declined" };
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
  if (clientId === setup.dynamicClientId) {
    if (!callbackClientId) {
      throw new Error("ChatGPT did not finish registering this app");
    }
    issuedClientId = callbackClientId;
  } else if (callbackClientId && callbackClientId !== clientId) {
    throw new Error("The sign-in came back for a different registration");
  }

  const tokens = await postToken(setup.tokenUrl, {
    client_id: issuedClientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectURI,
    resource: setup.resource,
  });
  if (!tokens.id_token) {
    throw new Error("ChatGPT returned no ID token");
  }
  const claims = await validateIdToken(tokens.id_token, {
    clientId: issuedClientId,
    nonce,
    setup,
  });
  if (target && claims.sub !== target.subject) {
    throw new Error(
      `Signed in to a different ChatGPT account than ${target.email ?? "this one"}. Add it as another account instead.`,
    );
  }

  // A registration OpenAI handed back again, for an account this host already
  // knows, updates that account rather than listing it twice.
  const existing =
    target ??
    registrations().find((candidate) => candidate.clientId === issuedClientId);
  const registration = registrationFromTokens(
    tokens,
    {
      addedAt: existing?.addedAt ?? Date.now(),
      clientId: issuedClientId,
      email: claims.email,
      id: existing?.id ?? AIProviderConfigIdSchema.parse(ulid()),
      name: claims.name,
      subject: claims.sub,
    },
    existing,
  );
  // Over whatever is stored now: the user's sign-in wins over any answer
  // still out for the tokens it replaces.
  saveUnlessReplaced(registrationById(registration.id), registration);
  grantOf(registration.id).send({ type: "signedIn" });
  const account = accountStatus(registration, registrations());
  if (account.state === "signed-out") {
    // Tokens with no refresh token: a session that ends within the hour.
    throw new Error("ChatGPT sign-in left the account without a session");
  }
  return {
    account,
    outcome: account.state === "plan-disabled" ? "plan-off" : "signed-in",
  };
}

const UNUSABLE_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "token_expired",
]);

/**
 * Each account's grant (chatgpt-grant.ts), which holds its refresh clock and
 * runs one refresh at a time: the refresh token rotates, so two racing
 * requests would spend it twice and lose the session.
 */
const grants = new Map<string, Actor<typeof grantMachine>>();
/** The longest wait between refreshes that keep failing. */
const MAX_REFRESH_BACKOFF_MS = 5 * 60 * 1000;

/** The account's grant, started on first use; it ends with a sign-out. */
function grantOf(id: string): Actor<typeof grantMachine> {
  const existing = grants.get(id);
  if (existing) {
    return existing;
  }
  const grant = createActor(
    grantMachine.provide({
      actions: {
        endSession: (_, { accessToken }) => {
          const stored = registrationById(id);
          if (stored?.accessToken === accessToken) {
            saveUnlessReplaced(stored, withoutTokens(stored));
          }
        },
      },
      actors: {
        refresh: fromPromise<RefreshOutcome, { id: string }>(({ input }) =>
          refreshTokens(input.id),
        ),
        revoke: fromPromise<{ revoked: boolean }, { id: string }>(({ input }) =>
          forgetAndRevoke(input.id),
        ),
      },
      delays: {
        refreshDelay: ({ context }) => {
          const registration = registrationById(context.id);
          return registration
            ? refreshDelayMs({
                account: registration,
                failures: context.failures,
                now: Date.now(),
              })
            : MAX_REFRESH_BACKOFF_MS;
        },
      },
      guards: {
        hasSession: ({ context }) =>
          Boolean(registrationById(context.id)?.refreshToken),
        isDue: ({ context }) => isDue(registrationById(context.id)),
      },
    }),
    { input: { id } },
  );
  grants.set(id, grant);
  grant.subscribe({
    complete: () => {
      if (grants.get(id) === grant) {
        grants.delete(id);
      }
    },
  });
  grant.start();
  return grant;
}

/** Whether an account's access token is close enough to expiring to replace now. */
function isDue(registration: Registration | undefined): boolean {
  return (
    registration?.refreshToken !== undefined &&
    (registration.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS
  );
}

/** The longest a request waits on a refresh before going out without it. */
const EXPIRED_REFRESH_WAIT_MS = 10 * 1000;

/**
 * Replace every access token that has already expired, and wait for it. A
 * launch after the app was closed for over an hour finds every token expired
 * and the refresh timers not yet fired, so a request read from the configs
 * right away would carry a token the API refuses.
 */
export async function refreshExpiredTokens(): Promise<void> {
  await Promise.all(
    registrations()
      .filter(
        (registration) =>
          registration.refreshToken &&
          (registration.expiresAt ?? 0) <= Date.now(),
      )
      .map(async (registration) => {
        const grant = grantOf(registration.id);
        grant.send({ type: "refreshDue" });
        await waitFor(
          grant,
          (snapshot) => !snapshot.matches({ active: "refreshing" }),
          { timeout: EXPIRED_REFRESH_WAIT_MS },
        ).catch(noop);
      }),
  );
}

/** Keep every account's token fresh; call once at startup. */
export function scheduleRefresh(): void {
  for (const registration of registrations()) {
    grantOf(registration.id);
  }
}

/**
 * How long until the next refresh: a margin before the token expires, never
 * before the server allows one, never sooner than a second, and later the
 * more refreshes in a row have failed.
 */
export function refreshDelayMs({
  account,
  failures,
  now,
}: {
  account: Pick<Registration, "earliestRefreshAt" | "expiresAt">;
  /** Refreshes that failed in a row. */
  failures: number;
  now: number;
}): number {
  const due = Math.max(
    (account.expiresAt ?? 0) - REFRESH_MARGIN_MS,
    account.earliestRefreshAt ?? 0,
  );
  // A refresh that failed leaves the token as due as it was, so without a
  // growing wait the next try would come every second for as long as the
  // network or the server is down.
  const backoff =
    failures === 0 ? 0 : Math.min(1000 * 2 ** failures, MAX_REFRESH_BACKOFF_MS);
  return Math.max(due - now, 1000, backoff);
}

/**
 * Catch the tokens up after the machine wakes. The refresh timers count on a
 * clock that stops while the machine sleeps, so after a sleep longer than a
 * token's hour one is still waiting for a token that has already expired, and
 * the first request after waking would carry it. A token still good is left
 * to a timer counted again from now.
 */
export function refreshAfterWake(): void {
  for (const registration of registrations()) {
    grantOf(registration.id).send({ type: "woke" });
  }
}

/** Sign out of one account and forget it. */
export async function signOutOfChatGPT({
  accountId,
}: {
  accountId: string;
}): Promise<{ revoked: boolean }> {
  if (!registrationById(accountId)) {
    return { revoked: true };
  }
  const grant = grantOf(accountId);
  // A refresh out when this is asked is waited for, so the token revoked is
  // the one it brought back.
  grant.send({ type: "signOut" });
  const done = await waitFor(grant, (snapshot) => snapshot.status === "done");
  return done.output ?? { revoked: false };
}

/**
 * Forgets the account and revokes its refresh token. Gone from the store
 * before the revocation is asked, so nothing that starts meanwhile can spend
 * the token or keep it.
 */
async function forgetAndRevoke(id: string): Promise<{ revoked: boolean }> {
  const registration = registrationById(id);
  lastVerifiedAt.delete(id);
  if (!registration) {
    return { revoked: true };
  }
  saveUnlessReplaced(registration, null);
  if (!registration.refreshToken) {
    return { revoked: true };
  }
  try {
    const discovery = await openIdConfiguration(currentSetup().discoveryUrl);
    const response = await fetch(discovery.revocation_endpoint, {
      body: new URLSearchParams({
        client_id: registration.clientId,
        token: registration.refreshToken,
        token_type_hint: "refresh_token",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return { revoked: response.ok };
  } catch (error) {
    log.warn("ChatGPT token revocation failed", error);
    return { revoked: false };
  }
}

/** One refresh of an account's tokens; its grant runs one at a time. */
async function refreshTokens(id: string): Promise<RefreshOutcome> {
  const registration = registrationById(id);
  if (!registration?.refreshToken) {
    return "ended";
  }
  if (
    registration.earliestRefreshAt &&
    Date.now() < registration.earliestRefreshAt
  ) {
    return "not-yet";
  }
  try {
    const { resource, tokenUrl } = currentSetup();
    const tokens = await postToken(tokenUrl, {
      client_id: registration.clientId,
      grant_type: "refresh_token",
      refresh_token: registration.refreshToken,
      resource,
    });
    return saveUnlessReplaced(
      registration,
      registrationFromTokens(tokens, registration, registration),
    )
      ? "refreshed"
      : "replaced";
  } catch (error) {
    if (
      error instanceof TokenError &&
      UNUSABLE_REFRESH_CODES.has(error.code ?? "")
    ) {
      log.warn("ChatGPT session ended; signing in again is required");
      return saveUnlessReplaced(registration, withoutTokens(registration))
        ? "ended"
        : "replaced";
    }
    // A network or server failure keeps the credentials for the next try.
    log.warn("ChatGPT token refresh failed", error);
    return "failed";
  }
}

function withoutTokens(registration: Registration): Registration {
  return {
    addedAt: registration.addedAt,
    clientId: registration.clientId,
    email: registration.email,
    id: registration.id,
    name: registration.name,
    // Kept so a later sign-in knows whether the plan was declined last time.
    scopes: registration.scopes,
    subject: registration.subject,
  };
}

const DiscoverySchema = z.object({
  issuer: z.string(),
  jwks_uri: z.string(),
  revocation_endpoint: z.string(),
});

// Keyed by its URL, so a setup that moves discovery is followed.
let discoveryCache: null | {
  promise: Promise<z.output<typeof DiscoverySchema>>;
  url: string;
} = null;

function openIdConfiguration(url: string) {
  if (discoveryCache?.url !== url) {
    const promise = fetch(url)
      .then((response) => response.json())
      .then((body) => DiscoverySchema.parse(body))
      .catch((error: unknown) => {
        if (discoveryCache?.promise === promise) {
          discoveryCache = null;
        }
        throw error;
      });
    discoveryCache = { promise, url };
  }
  return discoveryCache.promise;
}

const IdTokenClaimsSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.string().optional(),
  exp: z.number(),
  iss: z.string(),
  name: z.string().optional(),
  nonce: z.string().optional(),
  sub: z.string(),
});

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

async function validateIdToken(
  token: string,
  {
    clientId,
    nonce,
    setup,
  }: { clientId: string; nonce: string; setup: SignInSetup },
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
  const discovery = await openIdConfiguration(setup.discoveryUrl);
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
  if (claims.iss !== discovery.issuer && claims.iss !== setup.issuer) {
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
