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

/** Where the auth callback server takes OpenRouter's redirect. */
export const OPENROUTER_CALLBACK_PATH = "/auth/callback/openrouter";

/** How a connect ended; one that went wrong rejects with what went wrong. */
export interface OpenRouterConnectResult {
  outcome: "canceled" | "connected" | "declined";
}

interface PendingConnect {
  deliver: (params: URLSearchParams) => void;
  promise: Promise<OpenRouterConnectResult>;
  // The `state` the authorize URL carried; a redirect without it is not this
  // connect's.
  state: string;
  supersede: () => void;
}

let pendingConnect: null | PendingConnect = null;

const ExchangeResponseSchema = z.object({ key: z.string().min(1) });

/**
 * Hand OpenRouter's redirect to the connect waiting for it. Resolves once the
 * key is saved, so the page the browser lands on can say how it went;
 * undefined when nothing is waiting or the redirect is another connect's.
 *
 * OpenRouter leaves `state` off a denial, so a redirect carrying an error and
 * no code ends whatever connect is waiting as declined. The worst a page that
 * forges one can do is end a connect the person can start again.
 */
export function receiveOpenRouterCallback(
  params: URLSearchParams,
): Promise<OpenRouterConnectResult> | undefined {
  if (!pendingConnect) {
    return undefined;
  }
  const denied = !params.has("code") && params.has("error");
  if (!denied && params.get("state") !== pendingConnect.state) {
    return undefined;
  }
  pendingConnect.deliver(params);
  return pendingConnect.promise;
}

/**
 * Open OpenRouter's consent page in the browser, wait for the key it creates,
 * and hand it to `save` before settling, so the page the browser lands on says
 * connected only once the key is kept. Asking again while one is waiting replaces it, so a tab that was
 * closed is got past by connecting again rather than by canceling first.
 */
export function connectOpenRouter({
  callbackPort,
  save,
}: {
  callbackPort: number;
  save: (key: string) => Promise<void>;
}): Promise<OpenRouterConnectResult> {
  pendingConnect?.supersede();
  const controls: {
    deliver: (params: URLSearchParams) => void;
    supersede: () => void;
  } = { deliver: noop, supersede: noop };
  // Null when a newer connect took this one's place or it was canceled.
  const received = new Promise<null | URLSearchParams>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connecting OpenRouter timed out"));
    }, CONNECT_TIMEOUT_MS);
    controls.deliver = (params) => {
      clearTimeout(timeout);
      resolve(params);
    };
    controls.supersede = () => {
      clearTimeout(timeout);
      resolve(null);
    };
  });
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const entry: PendingConnect = {
    ...controls,
    promise: runConnect({ received, save, verifier }).finally(() => {
      if (pendingConnect === entry) {
        pendingConnect = null;
      }
    }),
    state,
  };
  pendingConnect = entry;

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set(
    "callback_url",
    `http://127.0.0.1:${String(callbackPort)}${OPENROUTER_CALLBACK_PATH}`,
  );
  url.searchParams.set(
    "code_challenge",
    base64url(createHash("sha256").update(verifier).digest()),
  );
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", APP_NAME);
  url.searchParams.set("state", state);
  void shell.openExternal(url.toString());

  return entry.promise;
}

/**
 * Give up on the connect waiting on the browser, if there is one: it settles
 * as canceled, and the browser's redirect, should it still come, is refused.
 */
export function cancelOpenRouterConnect() {
  pendingConnect?.supersede();
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

function base64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function noop() {
  // Stands in until the connect promise hands over its own.
}
