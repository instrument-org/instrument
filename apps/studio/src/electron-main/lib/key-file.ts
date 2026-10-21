import { is } from "@electron-toolkit/utils";
import { safeStorage } from "electron";

/**
 * How every key store in a workspace's `keys/` folder is written: plain JSON
 * in a development run, and JSON encrypted with this computer's key
 * (`safeStorage`, base64) otherwise. The stores and anything reading another
 * workspace's keys go through these, so both read one format.
 */
export const KEY_FILE_EXTENSION = is.dev ? "json" : "json.enc";

/** Each key store's name, and so its file's in the keys folder. */
export const KEY_STORE_NAMES = {
  chatgptAccount: "chatgpt-account",
  grokAccount: "grok-account",
  providerConfigs: "providers",
  session: is.dev ? "session-dev" : "session",
};

/** The key store `name`'s file, as its store names it. */
export function keyFileName(name: string): string {
  return `${name}.${KEY_FILE_EXTENSION}`;
}

/** The JSON a key file holds. Throws when it can't be decrypted. */
export function decodeKeyFile(value: string): string {
  if (is.dev) {
    return value;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Encryption is not available");
  }
  return safeStorage.decryptString(Buffer.from(value, "base64"));
}

/**
 * A key file holding `json`, or undefined where there is no keyring to
 * encrypt with (a Linux desktop without one, or CI).
 */
export function encodeKeyFile(json: string): string | undefined {
  if (is.dev) {
    return json;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  return safeStorage.encryptString(json).toString("base64");
}
