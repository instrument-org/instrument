import { logger } from "@/electron-main/lib/electron-logger";
import { noteSignedOut } from "@/electron-main/lib/notices";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  decodeKeyFile,
  encodeKeyFile,
  KEY_FILE_EXTENSION,
  KEY_STORE_NAMES,
} from "@/electron-main/lib/key-file";
import { publisher } from "@/electron-main/rpc/publisher";
import { focusAppWindow } from "@/electron-main/windows/foreground";
import { type AIGatewayProviderConfig } from "@instrument-org/ai-gateway";
import {
  AIProviderConfigIdSchema,
  GROK_ACCOUNT_PROVIDER_CONFIG,
} from "@instrument-org/shared";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { shell } from "electron";
import Store from "electron-store";
import { ulid } from "ulid";
import { type Actor, createActor, fromPromise, waitFor } from "xstate";
import { z } from "zod";

import { grantMachine, type RefreshOutcome } from "./chatgpt-grant";
import {
  BUILT_IN_GROK_SIGN_IN_SETUP,
  fetchGrokSignInSetup,
  type GrokSignInSetup,
  GrokSignInSetupSchema,
} from "./grok-sign-in-setup";

/**
 * Sign in with a Grok subscription (SuperGrok, or X Premium through a linked
 * X account): xAI's device-code flow against the public client our API names
 * (`grok-sign-in-setup.ts`), then each account's access token as the bearer
 * on xAI's API. A person can hold several accounts, and each is its own
 * provider config, so a chat runs on the account its model names.
 *
 * Tokens never leave the main process; the gateway reads the current ones
 * through the synthesized provider configs.
 */

const log = logger.scope("grok-account");

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_REFRESH_BACKOFF_MS = 5 * 60 * 1000;
const EXPIRED_REFRESH_WAIT_MS = 10 * 1000;
/** A refresh still unanswered after this is a failed one, tried again later. */
const REFRESH_TIMEOUT_MS = 15 * 1000;
const SUBSCRIPTION_CHECK_EVERY_MS = 30 * 1000;

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

const RegistrationSchema = z.object({
  accessToken: z.string().optional(),
  /** Unix milliseconds of the first sign-in, which orders the accounts. */
  addedAt: z.number(),
  /**
   * The client and issuer the account signed in through, which its refresh
   * token is bound to: a setup served later with another client applies to
   * new sign-ins only.
   */
  clientId: z.string().optional(),
  email: z.string().optional(),
  issuer: z.string().optional(),
  expiresAt: z.number().optional(),
  /** Ours, and the provider config id its models' URIs carry. */
  id: AIProviderConfigIdSchema,
  name: z.string().optional(),
  refreshToken: z.string().optional(),
  /** Who the account is to xAI, which two sign-ins to one account share. */
  subject: z.string(),
  /**
   * The subscription xAI last named for the account: a tier such as
   * "SuperGrok", null for none, absent until xAI has been asked.
   */
  tier: z.string().nullable().optional(),
  /** How xAI names that plan to people, such as "X Premium+". */
  tierName: z.string().optional(),
});
type Registration = z.output<typeof RegistrationSchema>;

const StoreSchema = z.object({
  // Keyed by `id`. One whose session ended elsewhere stays, without tokens,
  // so the card can say so; signing out removes it.
  // Read one at a time, so a record that no longer validates is dropped
  // alone rather than taking every account with it.
  registrations: z
    .record(z.string(), z.unknown())
    .default({})
    .transform((records) =>
      Object.fromEntries(
        Object.entries(records).flatMap(([id, record]) => {
          const parsed = RegistrationSchema.safeParse(record);
          return parsed.success ? [[id, parsed.data] as const] : [];
        }),
      ),
    ),
  // The last setup our API served, kept so refreshes follow it after a
  // restart. One that no longer validates is dropped rather than failing the
  // whole store.
  signInSetup: GrokSignInSetupSchema.optional().catch(undefined),
});
type StoreShape = z.output<typeof StoreSchema>;

let STORE: null | Store<StoreShape> = null;

export type GrokAccountState = "no-subscription" | "signed-in" | "signed-out";

export interface GrokAccountStatus {
  email?: string;
  id: string;
  /** What the account is called wherever accounts sit side by side. */
  label: string;
  state: GrokAccountState;
  /** The plan as a person reads it, such as "X Premium+", when xAI named one. */
  plan?: string;
}

export interface GrokAccountsStatus {
  /** In the order they were first signed in to. */
  accounts: GrokAccountStatus[];
  /** The code to enter on xAI's page while a sign-in waits on it. */
  pending?: { userCode: string; verificationUri: string };
}

export interface GrokSignInResult {
  account?: GrokAccountStatus;
  outcome: Extract<SignInOutcome, "canceled" | "declined" | "signed-in">;
}

/**
 * The sign-in under way, from the press on: its code once xAI has handed one
 * out, so a cancel before then still reaches it.
 */
let pending:
  | undefined
  | {
      code?: { userCode: string; verificationUri: string };
      controller: AbortController;
    };

/**
 * A provider config for each account that may use Grok. An account xAI names
 * no subscription for lists nothing to pick, rather than models that fail.
 */
export function grokAccountProviderConfigs(): AIGatewayProviderConfig.Type[] {
  const all = registrations();
  return all.flatMap((registration) => {
    if (!registration.accessToken || !hasSubscription(registration)) {
      return [];
    }
    if (isDue(registration)) {
      grantOf(registration.id).send({ type: "refreshDue" });
    }
    return [
      {
        ...GROK_ACCOUNT_PROVIDER_CONFIG,
        apiKey: registration.accessToken,
        baseURL: currentSetup().apiBaseURL,
        cacheIdentifier: `grok-account-${registration.id}`,
        displayName:
          all.length === 1
            ? GROK_ACCOUNT_PROVIDER_CONFIG.displayName
            : labelFor(registration, all),
        id: registration.id,
      },
    ];
  });
}

/** Everyone a Grok account kept here names, signed in or not. */
export function grokAccountPeople(): { email: string; name?: string }[] {
  return registrations().flatMap((registration) =>
    registration.email
      ? [{ email: registration.email, name: registration.name }]
      : [],
  );
}

export function grokAccountsStatus(): GrokAccountsStatus {
  const all = registrations();
  return {
    accounts: all.map((registration) => accountStatus(registration, all)),
    ...(pending?.code && { pending: pending.code }),
  };
}

function accountStatus(
  registration: Registration,
  all: Registration[],
): GrokAccountStatus {
  return {
    email: registration.email,
    id: registration.id,
    label: labelFor(registration, all),
    state: !registration.refreshToken
      ? "signed-out"
      : hasSubscription(registration)
        ? "signed-in"
        : "no-subscription",
    ...(registration.tier && {
      plan: registration.tierName ?? spellTier(registration.tier),
    }),
  };
}

/**
 * Whether xAI named a subscription, or has not been asked yet: an account is
 * held back only on xAI's word that it has none.
 */
function hasSubscription(registration: Registration): boolean {
  return (
    registration.tier === undefined ||
    (registration.tier !== null &&
      registration.tier.trim().toLowerCase() !== "free")
  );
}

/** The account's email, numbered from the second one on the same email. */
function labelFor(
  registration: Pick<Registration, "email" | "id" | "name">,
  all: Pick<Registration, "email" | "id">[],
): string {
  const label = registration.email ?? registration.name ?? "Grok account";
  const sameEmail = all.filter(
    (candidate) => candidate.email === registration.email,
  );
  const position = sameEmail.findIndex(
    (candidate) => candidate.id === registration.id,
  );
  return position > 0 ? `${label} (${String(position + 1)})` : label;
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
      cwd: workspaceKeysDir(),
      defaults,
      deserialize: (value) => {
        try {
          return StoreSchema.parse(JSON.parse(decodeKeyFile(value)));
        } catch (error) {
          log.error("Failed to read the Grok account store", error);
          return defaults;
        }
      },
      fileExtension: KEY_FILE_EXTENSION,
      name: KEY_STORE_NAMES.grokAccount,
      serialize: (value) => {
        // Without a keyring nothing is written, as the ChatGPT account's
        // store does: a sign-in then lasts until the app quits.
        const encoded = encodeKeyFile(JSON.stringify(value));
        if (encoded === undefined) {
          log.error("Encryption is not available");
          return "";
        }
        return encoded;
      },
    });
    STORE.onDidAnyChange(() => {
      publisher.publish("grok-account.updated", null);
      publisher.publish("provider-config.updated", null);
      noteSignedOutAccounts();
    });
    noteSignedOutAccounts();
  }
  return STORE;
}

/**
 * Tell the notices which accounts are signed out. Signing out forgets an
 * account, so one kept without its tokens is one whose session ended without
 * the person asking.
 */
function noteSignedOutAccounts() {
  const all = registrations();
  noteSignedOut(
    GROK_ACCOUNT_PROVIDER_CONFIG.type,
    all
      .filter((registration) => !registration.refreshToken)
      .map((registration) => ({
        id: registration.id,
        ...(all.length > 1 && { label: labelFor(registration, all) }),
      })),
  );
}

/** The setup to follow now: the last one our API served, or the built-in one. */
function currentSetup(): GrokSignInSetup {
  return getStore().get("signInSetup") ?? BUILT_IN_GROK_SIGN_IN_SETUP;
}

/**
 * Asks our API for the current setup before a sign-in, keeping what it serves
 * for later refreshes. When it cannot answer, the last one it served stands.
 */
async function loadSignInSetup(signal: AbortSignal): Promise<GrokSignInSetup> {
  const fetched = await fetchGrokSignInSetup(signal);
  if (fetched) {
    getStore().set("signInSetup", fetched);
  }
  return fetched ?? currentSetup();
}

/**
 * The one writer of the registrations. Writes `next` (or, with null, forgets
 * the registration) only when the stored one is still `spent`, the one the
 * caller read before it went out: undefined for an account not stored yet.
 * Otherwise a sign-in or sign-out replaced the grant while the request was
 * out, and its answer is dropped. Answers whether it wrote.
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
    log.info("Grok grant changed while a request was out; dropping its answer");
    return false;
  }
  const store = getStore();
  const { [id]: _replaced, ...rest } = store.get("registrations");
  store.set("registrations", next ? { ...rest, [id]: next } : rest);
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

// Each claim read on its own, so one of an unexpected type (an email of null
// on an account reached through X) leaves the rest standing.
const claim = z.string().optional().catch(undefined);
const ClaimsSchema = z.object({
  email: claim,
  name: claim,
  principal_id: claim,
  sub: claim,
});

/**
 * A JWT's claims, read without checking its signature: the token came
 * straight from xAI's token endpoint over TLS, and the claims only name the
 * account.
 */
function readClaims(jwt: string): z.output<typeof ClaimsSchema> {
  const payload = jwt.split(".")[1];
  if (!payload) {
    return {};
  }
  try {
    return ClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
  } catch {
    return {};
  }
}

function registrationFromTokens(
  tokens: z.output<typeof TokenResponseSchema>,
  identity: Pick<Registration, "addedAt" | "id" | "subject"> &
    Pick<Partial<Registration>, "clientId" | "issuer">,
  previous?: Registration,
): Registration {
  const claims = tokens.id_token ? readClaims(tokens.id_token) : {};
  const clientId = identity.clientId ?? previous?.clientId;
  const issuer = identity.issuer ?? previous?.issuer;
  return {
    accessToken: tokens.access_token,
    addedAt: identity.addedAt,
    ...(clientId && { clientId }),
    ...(issuer && { issuer }),
    email: claims.email ?? previous?.email,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    id: identity.id,
    name: claims.name ?? previous?.name,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    subject: identity.subject,
    ...(previous?.tier !== undefined && { tier: previous.tier }),
    ...(previous?.tierName !== undefined && { tierName: previous.tierName }),
  };
}

/** Who the tokens belong to, as xAI names the account. */
function subjectOf(tokens: z.output<typeof TokenResponseSchema>): string {
  const idClaims = tokens.id_token ? readClaims(tokens.id_token) : {};
  const accessClaims = readClaims(tokens.access_token);
  return (
    idClaims.sub ??
    accessClaims.principal_id ??
    accessClaims.sub ??
    // No claim names the account: every sign-in is an account of its own.
    `unnamed-${ulid()}`
  );
}

const UserSchema = z.object({
  subscriptionTier: z.string().nullable().optional(),
});

const SettingsSchema = z.object({
  subscription_tier_display: z.string().optional(),
});

/**
 * How xAI names the account's plan to people ("X Premium+"), read from its
 * settings. Undefined when that cannot be read, so the card spells the tier
 * itself instead.
 */
async function tierDisplayName(
  accessToken: string,
): Promise<string | undefined> {
  const url =
    currentSetup().settingsURL ?? BUILT_IN_GROK_SIGN_IN_SETUP.settingsURL;
  if (!url) {
    return undefined;
  }
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return undefined;
    }
    const parsed = SettingsSchema.safeParse(await response.json());
    return parsed.success
      ? parsed.data.subscription_tier_display?.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A tier's identifier as words, for when xAI's own name for it could not be
 * read: `XPremiumPlus` reads "X Premium Plus", and the SuperGrok brand stays
 * one word.
 */
export function spellTier(tier: string): string {
  return tier
    .replaceAll(/([a-z])([A-Z])|([A-Z])([A-Z][a-z])/g, "$1$3 $2$4")
    .replaceAll(/\bSuper Grok\b/g, "SuperGrok")
    .trim();
}

const lastSubscriptionCheck = new Map<string, number>();

/**
 * Ask xAI which subscription each account has, or the one `accountId` names.
 * Any xAI account signs in, subscription or not, and one without is turned
 * away only when it asks a model for something, so the card says so up front
 * and the account lists no models. `recent` skips an account asked in the last
 * half minute, as opening Settings does. A failed answer leaves the last one
 * standing.
 */
export async function checkGrokSubscriptions({
  accountId,
  recent = false,
}: { accountId?: string; recent?: boolean } = {}): Promise<void> {
  const { userURL } = currentSetup();
  await Promise.all(
    registrations()
      .filter(
        (registration) =>
          registration.accessToken &&
          (accountId === undefined || registration.id === accountId) &&
          !(
            recent &&
            Date.now() - (lastSubscriptionCheck.get(registration.id) ?? 0) <
              SUBSCRIPTION_CHECK_EVERY_MS
          ),
      )
      .map(async (registration) => {
        lastSubscriptionCheck.set(registration.id, Date.now());
        try {
          const response = await fetch(userURL, {
            // The filter above kept only accounts holding a token.
            headers: {
              authorization: `Bearer ${registration.accessToken ?? ""}`,
            },
          });
          if (!response.ok) {
            log.warn(
              `Couldn't read the Grok account's subscription (${String(response.status)})`,
            );
            return;
          }
          const body: unknown = await response.json();
          // Only an answer that names the field holds an account back: one
          // that changed shape says nothing, and leaves the last answer.
          if (
            typeof body !== "object" ||
            body === null ||
            !("subscriptionTier" in body)
          ) {
            log.warn(
              "xAI's answer about the Grok plan had no subscriptionTier",
            );
            return;
          }
          const user = UserSchema.parse(body);
          const tier = user.subscriptionTier ?? null;
          const tierName =
            tier === null
              ? undefined
              : await tierDisplayName(registration.accessToken ?? "");
          saveUnlessReplaced(registration, {
            ...registration,
            tier,
            ...(tierName && { tierName }),
          });
        } catch (error) {
          log.warn("Couldn't read the Grok account's subscription", error);
        }
      }),
  );
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
 * with the code filled in, and wait for the person to approve it there. An
 * account already signed in to is updated rather than listed twice. Asking
 * again while one waits replaces it.
 */
export async function signInWithGrok(): Promise<GrokSignInResult> {
  pending?.controller.abort();
  const controller = new AbortController();
  const { signal } = controller;
  try {
    pending = { controller };
    const setup = await loadSignInSetup(signal);
    const device = DeviceCodeSchema.parse(
      await postForm(
        `${setup.issuer}/device/code`,
        {
          client_id: setup.clientId,
          referrer: setup.referrer,
          scope: setup.scope,
        },
        signal,
      ),
    );
    const verificationUri =
      device.verification_uri_complete ?? device.verification_uri;
    if (signal.aborted) {
      return { outcome: "canceled" };
    }
    pending = {
      code: { userCode: device.user_code, verificationUri },
      controller,
    };
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
      let tokens: z.output<typeof TokenResponseSchema>;
      try {
        tokens = TokenResponseSchema.parse(
          await postForm(
            `${setup.issuer}/token`,
            {
              client_id: setup.clientId,
              device_code: device.device_code,
              grant_type: DEVICE_GRANT,
            },
            signal,
          ),
        );
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
      if (!tokens.refresh_token) {
        throw new Error("Grok sign-in left the account without a session");
      }
      const subject = subjectOf(tokens);
      const existing = registrations().find(
        (candidate) => candidate.subject === subject,
      );
      const registration = registrationFromTokens(
        tokens,
        {
          addedAt: existing?.addedAt ?? Date.now(),
          clientId: setup.clientId,
          id: existing?.id ?? AIProviderConfigIdSchema.parse(ulid()),
          issuer: setup.issuer,
          subject,
        },
        existing,
      );
      // Over whatever is stored now: the person's sign-in wins over any
      // answer still out for the tokens it replaces.
      saveUnlessReplaced(registrationById(registration.id), registration);
      grantOf(registration.id).send({ type: "signedIn" });
      await checkGrokSubscriptions({ accountId: registration.id });
      // The person approved on xAI's page; bring them back to the app.
      focusAppWindow();
      const saved = registrationById(registration.id) ?? registration;
      return {
        account: accountStatus(saved, registrations()),
        outcome: "signed-in",
      };
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

/**
 * Each account's grant (chatgpt-grant.ts), which holds its refresh clock and
 * runs one refresh at a time, since the refresh token rotates.
 */
const grants = new Map<string, Actor<typeof grantMachine>>();

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
        revoke: fromPromise<{ revoked: boolean }, { id: string }>(
          ({ input }) => {
            // xAI publishes no revocation endpoint for the shared client, so
            // signing out forgets the tokens here.
            saveUnlessReplaced(registrationById(input.id), null);
            lastSubscriptionCheck.delete(input.id);
            return Promise.resolve({ revoked: false });
          },
        ),
      },
      delays: {
        refreshDelay: ({ context }) => {
          const registration = registrationById(context.id);
          if (!registration) {
            return MAX_REFRESH_BACKOFF_MS;
          }
          const due = (registration.expiresAt ?? 0) - REFRESH_MARGIN_MS;
          const backoff =
            context.failures === 0
              ? 0
              : Math.min(1000 * 2 ** context.failures, MAX_REFRESH_BACKOFF_MS);
          return Math.max(due - Date.now(), 1000, backoff);
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

function isDue(registration: Registration | undefined): boolean {
  return (
    registration?.refreshToken !== undefined &&
    (registration.expiresAt ?? 0) - Date.now() < REFRESH_MARGIN_MS
  );
}

function withoutTokens(registration: Registration): Registration {
  return {
    addedAt: registration.addedAt,
    email: registration.email,
    id: registration.id,
    name: registration.name,
    subject: registration.subject,
  };
}

async function refreshTokens(id: string): Promise<RefreshOutcome> {
  const registration = registrationById(id);
  if (!registration?.refreshToken) {
    return "ended";
  }
  // The refresh token is bound to the client the account signed in through.
  const setup = currentSetup();
  const clientId = registration.clientId ?? setup.clientId;
  const issuer = registration.issuer ?? setup.issuer;
  try {
    const tokens = TokenResponseSchema.parse(
      await postForm(
        `${issuer}/token`,
        {
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: registration.refreshToken,
        },
        AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      ),
    );
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
      log.warn("Grok session ended; signing in again is required");
      return saveUnlessReplaced(registration, withoutTokens(registration))
        ? "ended"
        : "replaced";
    }
    log.warn("Grok token refresh failed", error);
    return "failed";
  }
}

/**
 * Replace the access token of `accountId`, or of every account, if it has
 * already expired, and wait for it, so a request right after a long sleep or
 * a cold launch carries a good one. An id that names another provider's
 * config waits on nothing.
 */
export async function refreshExpiredGrokTokens(
  accountId?: string,
): Promise<void> {
  await Promise.all(
    registrations()
      .filter(
        (registration) =>
          (accountId === undefined || registration.id === accountId) &&
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
        ).catch(() => {
          // A refresh still running past its wait is left to finish on its own.
        });
      }),
  );
}

/** Keep every account's token fresh; call once at startup. */
export function scheduleGrokRefresh(): void {
  for (const registration of registrations()) {
    grantOf(registration.id);
  }
}

/** Catch the tokens up after the machine wakes; see chatgpt-account.ts. */
export function refreshGrokAfterWake(): void {
  for (const registration of registrations()) {
    grantOf(registration.id).send({ type: "woke" });
  }
}

/** Sign out of one account and forget it. */
export async function signOutOfGrok({
  accountId,
}: {
  accountId: string;
}): Promise<void> {
  if (!registrationById(accountId)) {
    return;
  }
  const grant = grantOf(accountId);
  grant.send({ type: "signOut" });
  await waitFor(grant, (snapshot) => snapshot.status === "done");
}
