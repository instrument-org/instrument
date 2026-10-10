import { getAuthServerPort } from "@/electron-main/auth/state";
import { openExternal } from "@/electron-main/lib/open-external";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { getAnonymousPlatformApiHeaders } from "@/electron-main/platform-api/headers";
import { getToken } from "@/electron-main/platform-api/utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { getSessionStore } from "@/electron-main/stores/workspace/session";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import { createAuthClient } from "better-auth/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { captureServerException } from "../lib/capture-server-exception";

export const auth = createAuthClient({
  baseURL: `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/auth`,
});

export const store: {
  codeVerifier: null | string;
  state: null | string;
} = {
  codeVerifier: null,
  state: null,
};

const DesktopSignInSchema = z.object({
  token: z.string().min(1),
  user: z.object({ email: z.string() }),
});

/**
 * Trade the single-use token the API handed the loopback for a session, with
 * the PKCE verifier that proves this app started the sign-in.
 */
export async function exchangeDesktopSignIn({
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

/** Ends the Google sign-in waiting on the browser, as canceled. */
let cancelPendingSignIn: (() => void) | undefined;

/**
 * Open the API's Google sign-in in the user's browser and wait for it to come
 * back to the loopback server.
 * Starting again while one waits cancels that one, so only the newest tab can
 * land. Resolves "canceled" when the user gives up from the app.
 */
export async function signInSocial(): Promise<
  Extract<SignInOutcome, "canceled" | "declined" | "signed-in">
> {
  cancelPendingSignIn?.();
  const authServerPort = getAuthServerPort();
  if (authServerPort === null) {
    throw new Error("Auth server port is not set");
  }

  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  store.state = state;
  store.codeVerifier = codeVerifier;

  const url = new URL(
    `${import.meta.env.MAIN_VITE_APP_API_BASE_URL}/auth-desktop/start`,
  );
  url.searchParams.set("port", String(authServerPort));
  url.searchParams.set("state", state);
  url.searchParams.set(
    "code_challenge",
    createHash("sha256").update(codeVerifier).digest("base64url"),
  );

  const controller = new AbortController();
  const outcome = new Promise<
    Extract<SignInOutcome, "canceled" | "declined" | "signed-in">
  >((resolve, reject) => {
    const cancel = () => {
      // The callback for this sign-in is refused from here on.
      store.state = null;
      store.codeVerifier = null;
      resolve("canceled");
      controller.abort();
    };
    cancelPendingSignIn = cancel;

    async function waitForAuthUpdate() {
      const { signal } = controller;
      try {
        for await (const payload of publisher.subscribe(
          "auth.sign-in-outcome",
          { signal },
        )) {
          if (payload.outcome === "failed") {
            reject(new Error("Login failed", { cause: payload.error }));
          } else {
            resolve(payload.outcome);
          }
          break;
        }
      } catch {
        // Aborted by a cancel, which has already resolved.
      } finally {
        if (cancelPendingSignIn === cancel) {
          cancelPendingSignIn = undefined;
        }
        controller.abort();
      }
    }

    void waitForAuthUpdate();
  });

  try {
    await openExternal(url.toString());
  } catch (error) {
    cancelPendingSignIn?.();
    throw error;
  }
  return outcome;
}

/** Cancel the Google sign-in waiting on the browser, if there is one. */
export function cancelSignInSocial() {
  cancelPendingSignIn?.();
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
      { scopes: ["auth"] },
    );
  }
  return response;
}

export async function signOut() {
  const response = await revokeSession(getToken() ?? "");
  // The whole record, not just the bearer token, so nothing an earlier
  // sign-in left beside it outlives the sign-out.
  getSessionStore().clear();
  void setDefaultModel({ onlyIfOurModel: true });
  return response;
}
