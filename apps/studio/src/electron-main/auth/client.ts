import { getAuthServerPort } from "@/electron-main/auth/state";
import { openExternal } from "@/electron-main/lib/open-external";
import { setDefaultModel } from "@/electron-main/lib/set-default-model";
import { getToken } from "@/electron-main/platform-api/utils";
import { publisher } from "@/electron-main/rpc/publisher";
import { getSessionStore } from "@/electron-main/stores/session";
import { mergeGenerators } from "@instrument-org/shared/merge-generators";
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

export async function signInSocial() {
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
  await openExternal(url.toString());

  const promise = new Promise((resolve, reject) => {
    const onError = publisher.subscribe("auth.login-error");
    const onSuccess = publisher.subscribe("auth.login-success");

    async function waitForAuthUpdate() {
      for await (const payload of mergeGenerators([onError, onSuccess])) {
        if ("error" in payload) {
          reject(new Error("Login failed", { cause: payload.error }));
          break;
        } else {
          resolve(payload);
          break;
        }
      }
    }

    void waitForAuthUpdate();
  });

  return promise;
}

export async function signOut() {
  const response = await auth.signOut({
    fetchOptions: {
      headers: {
        authorization: `Bearer ${getToken() ?? ""}`,
      },
    },
  });
  if (response.error) {
    captureServerException(
      new Error("Logout failed", { cause: response.error }),
      { scopes: ["auth"] },
    );
  }
  const sessionStore = getSessionStore();
  sessionStore.set("apiBearerToken", null);
  void setDefaultModel({ onlyIfOurModel: true });
  return response;
}
