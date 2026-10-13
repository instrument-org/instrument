import { createLoopbackSignIn } from "@/electron-main/auth/loopback-sign-in";
import { AUTH_CALLBACK_PATHS } from "@/electron-main/auth/routes";
import { APP_NAME } from "@instrument-org/shared";
import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Connect OpenRouter in the browser: OpenRouter's PKCE flow creates an
 * ordinary API key on the person's account and hands it to the app, so it is
 * saved like a pasted one and revoked the same way, on OpenRouter's keys page.
 * No client registration is involved, and OpenRouter takes a loopback callback
 * on any port.
 */

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
const AUTHORIZE_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

/** How a connect ended; one that went wrong rejects with what went wrong. */
export interface OpenRouterConnectResult {
  outcome: "canceled" | "connected" | "declined";
}

const connects = createLoopbackSignIn<OpenRouterConnectResult>({
  // OpenRouter leaves `state` off a denial, so a redirect carrying an error
  // and no code ends whatever connect is waiting as declined. The worst a
  // page that forges one can do is end a connect the person can start again.
  accepts: (params, state) =>
    (!params.has("code") && params.has("error")) ||
    params.get("state") === state,
  timedOut: () => new Error("Connecting OpenRouter timed out"),
  timeoutMs: CONNECT_TIMEOUT_MS,
});

const ExchangeResponseSchema = z.object({ key: z.string().min(1) });

/**
 * Hand OpenRouter's redirect to the connect waiting for it. Resolves once the
 * key is saved, so the page the browser lands on can say how it went;
 * undefined when nothing is waiting or the redirect is another connect's.
 */
export function receiveOpenRouterCallback(
  params: URLSearchParams,
): Promise<OpenRouterConnectResult> | undefined {
  return connects.receive(params);
}

/**
 * Open OpenRouter's consent page in the browser, wait for the key it creates,
 * and hand it to `save` before settling, so the page the browser lands on says
 * connected only once the key is kept. Asking again while one is waiting replaces it, so a tab that was
 * closed is got past by connecting again rather than by canceling first.
 */
export function connectOpenRouter({
  callbackPort,
  keyLabel,
  save,
}: {
  callbackPort: number;
  /** What the key is called on OpenRouter's keys page, after the app. */
  keyLabel?: string;
  save: (key: string) => Promise<void>;
}): Promise<OpenRouterConnectResult> {
  const verifier = randomBytes(32).toString("base64url");
  return connects.start(({ received, state }) => {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set(
      "callback_url",
      `http://127.0.0.1:${String(callbackPort)}${AUTH_CALLBACK_PATHS.openrouter}`,
    );
    url.searchParams.set(
      "code_challenge",
      createHash("sha256").update(verifier).digest("base64url"),
    );
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set(
      "key_label",
      keyLabel ? `${APP_NAME} (${keyLabel})` : APP_NAME,
    );
    url.searchParams.set("state", state);
    void shell.openExternal(url.toString());

    return runConnect({ received, save, verifier });
  });
}

/**
 * Give up on the connect waiting on the browser, if there is one: it settles
 * as canceled, and the browser's redirect, should it still come, is refused.
 */
export function cancelOpenRouterConnect() {
  connects.supersede();
}

async function runConnect({
  received,
  save,
  verifier,
}: {
  received: Promise<null | URLSearchParams>;
  save: (key: string) => Promise<void>;
  verifier: string;
}): Promise<OpenRouterConnectResult> {
  const params = await received;
  if (!params) {
    return { outcome: "canceled" };
  }
  const code = params.get("code");
  if (!code) {
    return { outcome: "declined" };
  }
  const response = await fetch(EXCHANGE_URL, {
    body: JSON.stringify({
      code,
      code_challenge_method: "S256",
      code_verifier: verifier,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter didn't create a key (${String(response.status)})`,
    );
  }
  const { key } = ExchangeResponseSchema.parse(await response.json());
  await save(key);
  return { outcome: "connected" };
}
