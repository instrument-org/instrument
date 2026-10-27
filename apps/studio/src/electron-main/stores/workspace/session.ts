import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceKeysDir } from "@/electron-main/lib/get-workspace-folder";
import {
  decodeKeyFile,
  encodeKeyFile,
  KEY_FILE_EXTENSION,
  KEY_STORE_NAMES,
  keyFileDeserializer,
  keyFileName,
} from "@/electron-main/lib/key-file";
import { buildDefaultPlatformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { publisher } from "@/electron-main/rpc/publisher";
import { platformApiOriginOf } from "@/shared/platform-api-server";
import Store from "electron-store";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const SessionStateSchema = z.object({
  /**
   * The one sign-in an earlier build kept, made against the server that build
   * talked to. Moved under that server's origin in `apiBearerTokens` as the
   * file is read.
   */
  apiBearerToken: z.string().nullish(),
  /**
   * The bearer token of the sign-in to each platform API server, by the
   * server's origin, so pointing the app at another server keeps every
   * server's sign-in.
   */
  apiBearerTokens: z.record(z.string(), z.string()).optional(),
});

type SessionState = z.output<typeof SessionStateSchema>;

/**
 * `state` with an earlier build's one bearer token moved under the origin of
 * the server this build was made against, which is the one it signed in to.
 * A token already kept for that origin wins.
 */
function withTokensByOrigin(
  state: SessionState,
  defaultOrigin: string,
): SessionState {
  const { apiBearerToken, ...rest } = state;
  if (!apiBearerToken) {
    return rest;
  }
  return {
    ...rest,
    apiBearerTokens: {
      [defaultOrigin]: apiBearerToken,
      ...rest.apiBearerTokens,
    },
  };
}

function buildDefaultOrigin(): string {
  return platformApiOriginOf(buildDefaultPlatformApiBaseUrl());
}

let SESSION_STORE: null | Store<SessionState> = null;

// Set while reading a file that carries keys the schema does not know, or an
// earlier build's one token, so the store is rewritten once in today's shape.
let REWRITE_ON_OPEN = false;

/**
 * The known keys of a stored session. Anything else is dropped: a key no
 * build reads (an old provider token, say) would otherwise be re-encrypted
 * and kept on every write.
 */
function parseSessionState(raw: unknown): SessionState {
  const parsed = SessionStateSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error("Failed to parse session state", parsed.error);
    return {};
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    Object.keys(raw).some((key) => !(key in SessionStateSchema.shape))
  ) {
    REWRITE_ON_OPEN = true;
  }
  if (parsed.data.apiBearerToken != null) {
    REWRITE_ON_OPEN = true;
  }
  return withTokensByOrigin(parsed.data, buildDefaultOrigin());
}

/**
 * The bearer tokens, by server origin, that the session store in another
 * workspace's keys folder holds, read without opening it as a store. Empty
 * when it holds none or the file cannot be read.
 */
export function readBearerTokensIn(keysDir: string): Record<string, string> {
  let value: string;
  try {
    value = fs.readFileSync(
      path.join(keysDir, keyFileName(KEY_STORE_NAMES.session)),
      "utf8",
    );
  } catch {
    return {};
  }
  const parsed = SessionStateSchema.safeParse(decodeSessionFile(value));
  if (!parsed.success) {
    return {};
  }
  return (
    withTokensByOrigin(parsed.data, buildDefaultOrigin()).apiBearerTokens ?? {}
  );
}

/** A session file's JSON: plaintext in dev, safeStorage ciphertext otherwise. */
function decodeSessionFile(value: string): unknown {
  try {
    return JSON.parse(decodeKeyFile(value));
  } catch (error) {
    logger.error(error);
    return undefined;
  }
}

export const getSessionStore = (): Store<SessionState> => {
  if (SESSION_STORE === null) {
    SESSION_STORE = new Store<SessionState>({
      cwd: workspaceKeysDir(),
      deserialize: keyFileDeserializer({
        fallback: () => ({}),
        log: logger,
        lost: "the Instrument sign-ins",
        name: "the session store",
        parse: parseSessionState,
      }),
      fileExtension: KEY_FILE_EXTENSION,
      name: KEY_STORE_NAMES.session,
      serialize: (value) => {
        const encoded = encodeKeyFile(JSON.stringify(value));
        if (encoded === undefined) {
          logger.error("Encryption is not available");
          return "";
        }
        return encoded;
      },
    });

    // Reading the store parses it; writing back what was read leaves the file
    // holding only the known keys, with every token under its origin.
    const current = SESSION_STORE.store;
    if (REWRITE_ON_OPEN) {
      SESSION_STORE.store = current;
      REWRITE_ON_OPEN = false;
    }

    SESSION_STORE.onDidChange("apiBearerTokens", () => {
      publisher.publish("session.apiBearerToken.updated", null);
    });
  }

  return SESSION_STORE;
};

/** The bearer token of the sign-in to the server at `origin`, if there is one. */
export function getSessionToken(origin: string): string | undefined {
  return getSessionStore().get("apiBearerTokens")?.[origin];
}

/** Keep `token` as the sign-in to the server at `origin`. */
export function setSessionToken(origin: string, token: string) {
  const store = getSessionStore();
  store.set("apiBearerTokens", {
    ...store.get("apiBearerTokens"),
    [origin]: token,
  });
}

/** Forget the sign-in to the server at `origin`, keeping every other one. */
export function forgetSessionToken(origin: string) {
  const store = getSessionStore();
  const { [origin]: _forgotten, ...others } =
    store.get("apiBearerTokens") ?? {};
  store.set("apiBearerTokens", others);
}
