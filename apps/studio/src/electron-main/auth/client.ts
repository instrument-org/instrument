import { getAuthServerPort } from "@/electron-main/auth/state";
import { openExternal } from "@/electron-main/lib/open-external";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { getToken } from "@/electron-main/platform-api/utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { getSessionStore } from "@/electron-main/stores/workspace/session";
import { type SignInOutcome } from "@/shared/sign-in-outcome";
import * as arctic from "arctic";
import { createAuthClient } from "better-auth/client";
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

// Reaches us back through the provider's redirect, so it is parsed rather than
// asserted even though the caller has already matched it against the value we
// stored before the redirect.
const OAuthStateSchema = z.object({
  state: z.string(),
});

type OAuthState = z.output<typeof OAuthStateSchema>;

export function createGoogleProvider({ port }: { port: number }) {
  return new arctic.Google(
    import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? "invalid-client-id",
    import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? "invalid-client-secret",
    `http://localhost:${port}/auth/callback/google`,
  );
}

export function decodeOAuthState(encodedState: string): null | OAuthState {
  try {
    const decoded = Buffer.from(encodedState, "base64").toString("utf8");
    const parsed = OAuthStateSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    captureServerException(
      new Error("Failed to decode OAuth state", { cause: error }),
      { scopes: ["rpc", "auth"] },
    );
    return null;
  }
}

/** Ends the Google sign-in waiting on the browser, as canceled. */
let cancelPendingSignIn: (() => void) | undefined;

/**
 * Open Google's sign-in in the user's browser and wait for it to come back.
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

  const google = createGoogleProvider({ port: authServerPort });

  const baseState = arctic.generateState();
  const encodedState = Buffer.from(
    JSON.stringify({ state: baseState }),
  ).toString("base64");

  store.state = encodedState;
  store.codeVerifier = arctic.generateCodeVerifier();

  const scopes = ["email", "profile", "openid"];
  const url = google.createAuthorizationURL(
    encodedState,
    store.codeVerifier,
    scopes,
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
