import { createLoopbackSignIn } from "@/electron-main/auth/loopback-sign-in";
import { getAuthServerPort } from "@/electron-main/auth/state";
import { platformApiRpcClient } from "@/electron-main/platform-api/client";
import { openExternal } from "@/electron-main/lib/open-external";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import {
  platformApiBaseUrl,
  platformApiOrigin,
} from "@/electron-main/platform-api/base-url";
import { getToken } from "@/electron-main/platform-api/utils";
import {
  forgetSessionToken,
  setSessionToken,
} from "@/electron-main/stores/workspace/session";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { APP_DOMAIN } from "@instrument-org/shared";
import { accountSignedIn } from "@instrument-org/workspace/electron";
import { createAuthClient } from "better-auth/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { captureServerException } from "../lib/capture-server-exception";

/** The auth client of the platform API at `baseUrl`. */
function authClientFor(baseUrl: string) {
  return createAuthClient({ baseURL: `${baseUrl}/auth` });
}

const DesktopSignInSchema = z.object({
  /** The website page the browser goes on to, when the website takes over. */
  next: z.string().optional(),
  token: z.string().min(1),
  user: z.object({ email: z.string() }),
});

/**
 * Trade the single-use token the API handed the loopback for a session, with
 * the PKCE verifier that proves this app started the sign-in.
 */
async function exchangeDesktopSignIn({
  codeVerifier,
  token,
}: {
  codeVerifier: string;
  token: string;
}) {
  const response = await fetch(
    `${platformApiBaseUrl()}/auth-desktop/exchange`,
    {
      body: JSON.stringify({ token, verifier: codeVerifier }),
      headers: {
        ...getAnonymousPlatformApiHeaders(),
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(`Sign-in exchange failed with ${response.status}`);
  }
  return DesktopSignInSchema.parse(await response.json());
}

/**
 * How a Google sign-in to Instrument ended, and who it signed in when it did.
 * One that went wrong rejects instead, with what went wrong.
 */
type InstrumentSignInResult =
  | {
      email: string;
      /** The website page to send the browser on to, with the port added. */
      next?: string;
      outcome: Extract<SignInOutcome, "signed-in">;
    }
  | {
      outcome: Extract<
        SignInOutcome,
        "canceled" | "declined" | "sign-up-refused"
      >;
    };

/** How long a Google sign-in waits on the browser before it gives up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const signIns = createLoopbackSignIn<InstrumentSignInResult>({
  timedOut: () => new Error("Google sign-in timed out"),
  timeoutMs: SIGN_IN_TIMEOUT_MS,
});

/**
 * Hand the API's redirect to the Google sign-in waiting for it. Resolves once
 * the sign-in has finished; undefined when none is waiting or the redirect
 * carries another `state`. One callback per sign-in started: a second visit
 * finds nothing waiting.
 */
export function receiveInstrumentCallback(
  params: URLSearchParams,
): Promise<InstrumentSignInResult> | undefined {
  return signIns.receive(params);
}

/**
 * Open the API's Google sign-in in the user's browser and wait for it to come
 * back to the loopback server.
 * Starting again while one waits cancels that one, so only the newest tab can
 * land. Resolves "canceled" when the user gives up from the app.
 */
export async function signInSocial(): Promise<
  "on-web" | InstrumentSignInResult["outcome"]
> {
  const authServerPort = getAuthServerPort();
  if (authServerPort === null) {
    signIns.supersede();
    throw new Error("Auth server port is not set");
  }

  const codeVerifier = randomBytes(32).toString("base64url");
  const result = await signIns.start(async ({ received, state }) => {
    const url = new URL(`${platformApiBaseUrl()}/auth-desktop/start`);
    url.searchParams.set("callback_version", "2");
    url.searchParams.set("port", String(authServerPort));
    url.searchParams.set("state", state);
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier).digest("base64url"),
    );
    await openExternal(url.toString());

    const params = await received;
    if (!params) {
      return { outcome: "canceled" };
    }
    const ended = params.get("error");
    if (ended === "access_denied") {
      return { outcome: "declined" };
    }
    // Better Auth's code when the account could not be created, which the
    // API answers for an address outside the domains open for sign-up.
    if (ended === "unable_to_create_user") {
      return { outcome: "sign-up-refused" };
    }
    const token = params.get("token");
    let email: string;
    let next: string | undefined;
    try {
      if (token === null) {
        throw new Error(`Sign-in ended with ${ended ?? "no token"}`);
      }
      const signedIn = await exchangeDesktopSignIn({ codeVerifier, token });
      setSessionToken(platformApiOrigin(), signedIn.token);
      email = signedIn.user.email;
      next = continueOnWebsite(signedIn.next, authServerPort);
    } catch (error) {
      throw new Error("Login failed", { cause: error });
    }
    // Instrument's models become the default only when nothing is chosen:
    // someone who came in on a plan or a key keeps the model they picked.
    void setDefaultModel({ replacing: "nothing" });
    // A chat that asked for an image nothing else could make goes on with it.
    accountSignedIn();
    return { email, ...(next && { next }), outcome: "signed-in" };
  });
  if (result.outcome === "signed-in" && result.next) {
    webWait = startWebWait();
    return "on-web";
  }
  return result.outcome;
}

/**
 * `next` with this app's loopback port added, when it is a page on the
 * website this build talks to: the same host family as the platform API
 * (tryinstrument.com and its subdomains, or a local API's localhost).
 * Anything else is dropped, so the sign-in ends on the app's own page.
 */
export function continueOnWebsite(next: string | undefined, port: number) {
  if (!next || !URL.canParse(next)) {
    return undefined;
  }
  const url = new URL(next);
  const api = new URL(platformApiBaseUrl()).hostname;
  const isLocal = (host: string) =>
    host === "localhost" || host === "127.0.0.1";
  const allowed = isLocal(api)
    ? isLocal(url.hostname)
    : url.protocol === "https:" &&
      (url.hostname === APP_DOMAIN || url.hostname.endsWith(`.${APP_DOMAIN}`));
  if (!allowed) {
    return undefined;
  }
  url.searchParams.set("port", String(port));
  return url.toString();
}

/** How long the app waits on the website before it moves on by itself. */
const WEB_WAIT_MS = 30 * 60 * 1000;
/** How often it reads the account while it waits, within the API's limit. */
const WEB_POLL_MS = 10_000;

/** How a sign-up that went on to the website came back. */
export type WebOutcome = "signed-in" | "use-subscription";

let webWait:
  | { finish: (outcome: WebOutcome) => void; finished: Promise<WebOutcome> }
  | undefined;

/**
 * Waits on the website after a sign-in it took over, or after the app sent
 * the person to its plans: ends once the account has a plan or a running trial (read every few seconds), once the website
 * sends the browser back for a subscription the person already pays for,
 * when the person gives up in the app, or after half an hour. Every ending
 * but the subscription is "signed-in": the account is signed in either way.
 */
function startWebWait() {
  webWait?.finish("signed-in");
  let finish: (outcome: WebOutcome) => void = () => {};
  const finished = new Promise<WebOutcome>((resolve) => {
    finish = resolve;
  });
  const poll = setInterval(() => {
    void platformApiRpcClient.billing.status
      .call()
      .then((status) => {
        if (status.subscription || status.trial.state === "active") {
          wait.finish("signed-in");
        }
      })
      .catch(() => {});
  }, WEB_POLL_MS);
  const timeout = setTimeout(() => {
    wait.finish("signed-in");
  }, WEB_WAIT_MS);
  const wait = {
    finish: (outcome: WebOutcome) => {
      clearInterval(poll);
      clearTimeout(timeout);
      if (webWait === wait) {
        webWait = undefined;
      }
      finish(outcome);
    },
    finished,
  };
  return wait;
}

/**
 * Waits on the website the way a sign-in it took over does, for a plan the
 * person chooses there after signing in from the app.
 */
export function waitOnWebsite() {
  webWait = startWebWait();
}

/**
 * Resolves how the sign-up the website took over ended; "signed-in" at once
 * when none is waiting.
 */
export function finishOnWeb(): Promise<WebOutcome> {
  return webWait?.finished ?? Promise.resolve("signed-in");
}

/**
 * The website's Open Instrument button reached the loopback: `subscriptions`
 * ends the wait so setup can offer the person's own subscription.
 */
export function receiveAppOpen(step: string | undefined) {
  if (step === "subscriptions") {
    webWait?.finish("use-subscription");
  }
}

/** Cancel the Google sign-in waiting on the browser, if there is one. */
export function cancelSignInSocial() {
  signIns.supersede();
  webWait?.finish("signed-in");
}

/**
 * End the platform session a bearer token belongs to, on the server at
 * `baseUrl` (the one this process talks to unless named). Reported rather
 * than thrown when the platform refuses, since every caller goes on to drop
 * the token either way.
 */
export async function revokeSession(
  token: string,
  baseUrl = platformApiBaseUrl(),
) {
  const response = await authClientFor(baseUrl).signOut({
    fetchOptions: {
      headers: {
        authorization: `Bearer ${token}`,
      },
      // A server that no longer answers (a typed-in one off the network)
      // must not hold up sign-out or a workspace's deletion.
      signal: AbortSignal.timeout(10_000),
    },
  });
  if (response.error) {
    captureServerException(
      new Error("Logout failed", { cause: response.error }),
      { area: "auth" },
    );
  }
  return response;
}

export async function signOut() {
  const response = await revokeSession(getToken() ?? "");
  // This server's sign-in alone: another server's is kept for when the app
  // is pointed back at it.
  forgetSessionToken(platformApiOrigin());
  void setDefaultModel({ replacing: "ours" });
  return response;
}
