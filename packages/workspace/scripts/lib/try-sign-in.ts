import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APP_NAME, PORTS } from "@instrument-org/shared";
import { noop } from "radashi";
import { z } from "zod";

import {
  createMcpOAuthProvider,
  type McpOAuthStore,
} from "../../src/lib/apps/mcp/oauth-provider";
import {
  type RegistrationRefusal,
  watchRegistration,
} from "../../src/lib/apps/mcp/registration";

/** How far a sign-in got before a person would have been asked to approve it. */
export type SignInAttempt =
  /** The service registered Instrument; `removed` is whether it took the registration back. */
  | { kind: "accepted"; removed: boolean }
  /** The service answered that it will not register Instrument. */
  | ({ kind: "refused" } & RegistrationRefusal)
  /** It answered without asking for a sign-in. */
  | { kind: "open" }
  /** Something else stopped it. */
  | { kind: "failed"; said: string };

/** Where a registration says it is managed (RFC 7592), when it does. */
const ManagedRegistrationSchema = z.object({
  registration_access_token: z.string(),
  registration_client_uri: z.url(),
});

const TIMEOUT_MS = 20_000;

/**
 * Starts a sign-in to a hosted MCP server the way the app does, up to the
 * page a person would approve, which is never opened: the same provider and
 * registration request, from the app's own callback address. That registers a
 * client named Instrument with the service, so one that offers to take the
 * registration back is asked to.
 */
export async function trySignIn(
  endpoint: string,
  fetchFn: typeof fetch = fetch,
): Promise<SignInAttempt> {
  const url = new URL(endpoint);
  let managed: z.output<typeof ManagedRegistrationSchema> | undefined;
  let approvalPage: URL | undefined;
  const registration = watchRegistration(async (input, init) => {
    const response = await fetchFn(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    managed = ManagedRegistrationSchema.safeParse(body).data ?? managed;
    return response;
  });
  const provider = createMcpOAuthProvider({
    openAuthorization: (page) => {
      approvalPage = page;
    },
    origin: url.origin,
    redirectUrl: `http://127.0.0.1:${String(PORTS.authCallback.prod)}/auth/callback/app`,
    slug: "try-sign-in",
    store: memoryStore(),
  });
  const client = new Client({ name: APP_NAME, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: provider,
    fetch: registration.fetch,
  });
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    return { kind: "open" };
  } catch (error) {
    if (approvalPage !== undefined && error instanceof UnauthorizedError) {
      return {
        kind: "accepted",
        removed: await removeClient(managed, fetchFn),
      };
    }
    const refusal = registration.refusal();
    return refusal === undefined
      ? {
          kind: "failed",
          said: error instanceof Error ? error.message : String(error),
        }
      : { kind: "refused", ...refusal };
  } finally {
    await client.close().catch(noop);
  }
}

async function removeClient(
  managed: z.output<typeof ManagedRegistrationSchema> | undefined,
  fetchFn: typeof fetch,
): Promise<boolean> {
  if (managed === undefined) {
    return false;
  }
  const response = await fetchFn(managed.registration_client_uri, {
    headers: { authorization: `Bearer ${managed.registration_access_token}` },
    method: "DELETE",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => undefined);
  return response?.ok === true;
}

/** A store for one attempt, gone when it ends. */
function memoryStore(): McpOAuthStore {
  const kept: {
    client?: Awaited<ReturnType<McpOAuthStore["getClientInformation"]>>;
    state?: string;
    verifier?: string;
  } = {};
  return {
    clearClientInformation: () => {
      kept.client = undefined;
      return Promise.resolve();
    },
    clearTokens: () => Promise.resolve(),
    clearTransient: () => {
      kept.state = undefined;
      kept.verifier = undefined;
      return Promise.resolve();
    },
    getClientInformation: () => Promise.resolve(kept.client),
    getCodeVerifier: () => Promise.resolve(kept.verifier),
    getState: () => Promise.resolve(kept.state),
    getTokens: () => Promise.resolve(undefined),
    saveClientInformation: (_slug, info) => {
      kept.client = info;
      return Promise.resolve();
    },
    saveCodeVerifier: (_slug, verifier) => {
      kept.verifier = verifier;
      return Promise.resolve();
    },
    saveState: (_slug, state) => {
      kept.state = state;
      return Promise.resolve();
    },
    saveTokens: () => Promise.resolve(),
  };
}
