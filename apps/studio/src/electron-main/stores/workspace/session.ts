import { logger } from "@/electron-main/lib/electron-logger";
import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { is } from "@electron-toolkit/utils";
import { safeStorage } from "electron";
import Store from "electron-store";
import { z } from "zod";

const SessionStateSchema = z.object({
  apiBearerToken: z.string().nullish(),
});

type SessionState = z.output<typeof SessionStateSchema>;

let SESSION_STORE: null | Store<SessionState> = null;

// Set while reading a file that carries keys the schema does not know, so the
// store is rewritten once with only the known ones.
let READ_UNKNOWN_KEYS = false;

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
    READ_UNKNOWN_KEYS = true;
  }
  return parsed.data;
}

export const getSessionStore = (): Store<SessionState> => {
  if (SESSION_STORE === null) {
    SESSION_STORE = new Store<SessionState>({
      cwd: workspaceSettingsDir(),
      deserialize: (value) => {
        if (is.dev) {
          return parseSessionState(JSON.parse(value));
        }

        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          return {};
        }

        try {
          return parseSessionState(
            JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64"))),
          );
        } catch (error) {
          logger.error(error);
          return {};
        }
      },
      fileExtension: is.dev ? "json" : "json.enc",
      name: is.dev ? "session-dev" : "session",
      serialize: (value) => {
        if (is.dev) {
          return JSON.stringify(value);
        }

        if (!safeStorage.isEncryptionAvailable()) {
          logger.error("Encryption is not available");
          return "";
        }

        const json = JSON.stringify(value);
        return safeStorage.encryptString(json).toString("base64");
      },
    });

    // Reading the store parses it; writing back what was read leaves the file
    // holding only the known keys.
    const current = SESSION_STORE.store;
    if (READ_UNKNOWN_KEYS) {
      SESSION_STORE.store = current;
      READ_UNKNOWN_KEYS = false;
    }

    SESSION_STORE.onDidChange("apiBearerToken", () => {
      publisher.publish("session.apiBearerToken.updated", null);
    });
  }

  return SESSION_STORE;
};
