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

/**
 * A key store's `deserialize`: `parse` reads the decoded JSON, and a file
 * that can't be decoded or parsed answers `fallback()`, empty. The store
 * reads its file again on every `get`, so a failed file is remembered by its
 * contents: the failure is logged once, with `lost` (what the person finds
 * missing) in the line, and the same contents answer `fallback()` without
 * being decrypted again until the file changes, which saving to the store
 * (signing in again, adding the key again) does.
 */
export function keyFileDeserializer<T>({
  fallback,
  log,
  lost,
  name,
  parse,
}: {
  fallback: () => T;
  log: { error: (...data: unknown[]) => void };
  /** What reads as gone while the file can't be read: "ChatGPT sign-ins". */
  lost: string;
  /** The store, as a log line names it: "the ChatGPT account store". */
  name: string;
  parse: (json: unknown) => T;
}): (value: string) => T {
  let unreadable: string | undefined;
  return (value) => {
    if (value === unreadable) {
      return fallback();
    }
    try {
      return parse(JSON.parse(decodeKeyFile(value)));
    } catch (error) {
      // Before the app is ready no file can be decrypted, so only a failure
      // with encryption available says the file itself is unreadable.
      if (is.dev || safeStorage.isEncryptionAvailable()) {
        unreadable = value;
      }
      log.error(
        `Can't read ${name}, so ${lost} read as gone until they are saved again. A key file encrypted by another build of the app, or before this computer's keyring was reset, can't be decrypted here.`,
        error,
      );
      return fallback();
    }
  };
}
