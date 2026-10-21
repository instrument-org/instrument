import { createLoopbackSignIn } from "@/electron-main/auth/loopback-sign-in";
import { getAuthServerPort } from "@/electron-main/auth/state";
import { openExternal } from "@/electron-main/lib/open-external";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getToken } from "@/electron-main/platform-api/utils";
import { getSessionStore } from "@/electron-main/stores/workspace/session";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { createAuthClient } from "better-auth/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { captureServerException } from "../lib/capture-server-exception";

const auth = createAuthClient({
  baseURL: `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/auth`,
});

const DesktopSignInSchema = z.object({
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
    `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/auth-desktop/exchange`,
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
  | { email: string; outcome: Extract<SignInOutcome, "signed-in"> }
  | {
      outcome: Extract<
        SignInOutcome,
        "canceled" | "declined" | "sign-up-refused"
      >;
    };

const signIns = createLoopbackSignIn<InstrumentSignInResult>({});

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
  InstrumentSignInResult["outcome"]
> {
  const authServerPort = getAuthServerPort();
  if (authServerPort === null) {
    signIns.supersede();
    throw new Error("Auth server port is not set");
  }

  const codeVerifier = randomBytes(32).toString("base64url");
  const result = await signIns.start(async ({ received, state }) => {
    const url = new URL(
      `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/auth-desktop/start`,
    );
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
    try {
      if (token === null) {
        throw new Error(`Sign-in ended with ${ended ?? "no token"}`);
      }
      const signedIn = await exchangeDesktopSignIn({ codeVerifier, token });
      getSessionStore().set("apiBearerToken", signedIn.token);
      getWorkspaceState().set("hasCompletedProviderSetup", true);
      email = signedIn.user.email;
    } catch (error) {
      throw new Error("Login failed", { cause: error });
    }
    void setDefaultModel({ replacing: "anything" });
    return { email, outcome: "signed-in" };
  });
  return result.outcome;
}

/** Cancel the Google sign-in waiting on the browser, if there is one. */
export function cancelSignInSocial() {
  signIns.supersede();
}

/**
 * End the platform session a bearer token belongs to. Reported rather than
 * thrown when the platform refuses, since every caller goes on to drop the
 * token either way.
 */
export async function revokeSession(token: string) {
  const response = await auth.signOut({
    fetchOptions: {
      headers: {
        authorization: `Bearer ${token}`,
      },
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
  // The whole record, not just the bearer token, so nothing an earlier
  // sign-in left beside it outlives the sign-out.
  getSessionStore().clear();
  void setDefaultModel({ replacing: "ours" });
  return response;
}
