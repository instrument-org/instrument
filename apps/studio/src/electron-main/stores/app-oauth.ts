import { logger } from "@/electron-main/lib/electron-logger";
import { is } from "@electron-toolkit/utils";
import {
  type McpOAuthStore,
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@instrument-org/workspace/electron";
import { safeStorage } from "electron";
import Store from "electron-store";

interface AppOAuthStoreShape {
  flows: Record<string, OAuthFlowRecord>;
}

// One OAuth flow per app slug: the client registration, the access and
// refresh tokens, and transient PKCE material for an in-flight authorization.
interface OAuthFlowRecord {
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
  state?: string;
  tokens?: OAuthTokens;
}

// Encrypted at rest through safeStorage (plaintext only in dev), like the
// credentials store. Tokens and client secrets live only here, never in an
// app's folder or the model's context.
let STORE: null | Store<AppOAuthStoreShape> = null;

function getFlow(slug: string): OAuthFlowRecord {
  return getStore().get("flows")[slug] ?? {};
}

function getStore(): Store<AppOAuthStoreShape> {
  if (!STORE) {
    const defaults: AppOAuthStoreShape = { flows: {} };
    STORE = new Store<AppOAuthStoreShape>({
      defaults,
      deserialize: (value) => {
        if (is.dev) {
          return JSON.parse(value) as AppOAuthStoreShape;
        }
        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          return defaults;
        }
        try {
          const decrypted = safeStorage.decryptString(
            Buffer.from(value, "base64"),
          );
          return JSON.parse(decrypted) as AppOAuthStoreShape;
        } catch (error) {
          logger.error("Failed to decrypt the app OAuth store", error);
          return defaults;
        }
      },
      fileExtension: is.dev ? "json" : "json.enc",
      name: "app-oauth",
      serialize: (value) => {
        if (is.dev) {
          return JSON.stringify(value);
        }
        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          throw new Error("Encryption is not available");
        }
        return safeStorage
          .encryptString(JSON.stringify(value))
          .toString("base64");
      },
    });
  }
  return STORE;
}

// Rewrite a flow record with the given keys removed (an undefined spread would
// leave them present with an undefined value in the persisted JSON).
function omitFlowKeys(slug: string, keys: (keyof OAuthFlowRecord)[]): void {
  const flows = getStore().get("flows");
  const current = flows[slug];
  if (!current) {
    return;
  }
  const drop = new Set<string>(keys);
  const next: OAuthFlowRecord = {};
  for (const [key, value] of Object.entries(current)) {
    if (!drop.has(key)) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  getStore().set("flows", { ...flows, [slug]: next });
}

function setFlow(slug: string, patch: Partial<OAuthFlowRecord>): void {
  const flows = getStore().get("flows");
  getStore().set("flows", {
    ...flows,
    [slug]: { ...flows[slug], ...patch },
  });
}

/** The workspace-facing OAuth store, backed by the encrypted electron-store. */
export const appOAuthStore: McpOAuthStore = {
  clearClientInformation: (slug) => {
    omitFlowKeys(slug, ["clientInformation"]);
    return Promise.resolve();
  },
  clearTokens: (slug) => {
    omitFlowKeys(slug, ["tokens"]);
    return Promise.resolve();
  },
  clearTransient: (slug) => {
    omitFlowKeys(slug, ["codeVerifier", "state"]);
    return Promise.resolve();
  },
  getClientInformation: (slug) =>
    Promise.resolve(getFlow(slug).clientInformation),
  getCodeVerifier: (slug) => Promise.resolve(getFlow(slug).codeVerifier),
  getState: (slug) => Promise.resolve(getFlow(slug).state),
  getTokens: (slug) => Promise.resolve(getFlow(slug).tokens),
  saveClientInformation: (slug, info) => {
    setFlow(slug, { clientInformation: info });
    return Promise.resolve();
  },
  saveCodeVerifier: (slug, verifier) => {
    setFlow(slug, { codeVerifier: verifier });
    return Promise.resolve();
  },
  saveState: (slug, state) => {
    setFlow(slug, { state });
    return Promise.resolve();
  },
  saveTokens: (slug, tokens) => {
    setFlow(slug, { tokens });
    return Promise.resolve();
  },
};

/** Drop every stored OAuth artifact for an app (used on disconnect). */
export function clearAppOAuth(slug: string): void {
  const { [slug]: _dropped, ...rest } = getStore().get("flows");
  getStore().set("flows", rest);
}
