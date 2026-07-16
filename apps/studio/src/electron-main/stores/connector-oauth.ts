import { logger } from "@/electron-main/lib/electron-logger";
import { is } from "@electron-toolkit/utils";
import {
  type McpOAuthStore,
  type OAuthClientInformationFull,
  type OAuthTokens,
} from "@instrument-org/workspace/electron";
import { safeStorage } from "electron";
import Store from "electron-store";

interface ConnectorOAuthStoreShape {
  flows: Record<string, OAuthFlowRecord>;
}

// One OAuth "flow" per connector slug: the DCR client registration, the access/
// refresh tokens, and transient PKCE material for an in-flight authorization.
interface OAuthFlowRecord {
  clientInformation?: OAuthClientInformationFull;
  codeVerifier?: string;
  state?: string;
  tokens?: OAuthTokens;
}

// Encrypted at rest via safeStorage (plaintext only in dev), mirroring
// connector-credentials.ts. Tokens and client secrets live only here -- never
// in connector files or the model.
let STORE: null | Store<ConnectorOAuthStoreShape> = null;

function getFlow(slug: string): OAuthFlowRecord {
  return getStore().get("flows")[slug] ?? {};
}

function getStore(): Store<ConnectorOAuthStoreShape> {
  if (!STORE) {
    const defaults: ConnectorOAuthStoreShape = { flows: {} };
    STORE = new Store<ConnectorOAuthStoreShape>({
      defaults,
      deserialize: (value) => {
        if (is.dev) {
          return JSON.parse(value) as ConnectorOAuthStoreShape;
        }
        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          return defaults;
        }
        try {
          const decrypted = safeStorage.decryptString(
            Buffer.from(value, "base64"),
          );
          return JSON.parse(decrypted) as ConnectorOAuthStoreShape;
        } catch (error) {
          logger.error("Failed to decrypt connector OAuth store", error);
          return defaults;
        }
      },
      fileExtension: is.dev ? "json" : "json.enc",
      name: "connector-oauth",
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

// Rewrite a flow record with the given keys removed (undefined-spread would
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
export const connectorOAuthStore: McpOAuthStore = {
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

/** Drop every stored OAuth artifact for a connector (used on disconnect). */
export function clearConnectorOAuth(slug: string): void {
  const { [slug]: _dropped, ...rest } = getStore().get("flows");
  getStore().set("flows", rest);
}
