import { is } from "@electron-toolkit/utils";
import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * How every key store in a workspace's `keys/` folder is written: plain JSON
 * in a development run, and JSON encrypted with this computer's key
 * (`safeStorage`, base64) otherwise. The stores and anything reading another
 * workspace's keys go through these, so both read one format.
 */
export const KEY_FILE_EXTENSION = is.dev ? "json" : "json.enc";

/** Each key store's name, and so its file's in the keys folder. */
export const KEY_STORE_NAMES = {
  appCredentials: "app-credentials",
  appOAuth: "app-oauth",
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

/** What the person is told when a key or sign-in can't be kept. */
export const KEYS_NOT_SAVABLE =
  "Your computer’s keyring isn’t available, so Instrument can’t save this. Unlock it, then try again.";

/** Whether there is a keyring to encrypt a key file with. */
export function canSaveKeys(): boolean {
  return is.dev || safeStorage.isEncryptionAvailable();
}

/**
 * Throws when a change to the key store `name` in `dir` would be lost, for a
 * store that says so rather than keep the change until the app quits. A
 * removal (`removes`) is lost only where a file holds something to remove.
 */
export function requireSavableKeys({
  dir,
  name,
  removes = false,
}: {
  dir: () => string;
  name: string;
  removes?: boolean;
}): void {
  if (canSaveKeys()) {
    return;
  }
  if (removes) {
    const file = fs.statSync(path.join(dir(), keyFileName(name)), {
      throwIfNoEntry: false,
    });
    if (file === undefined || file.size === 0) {
      return;
    }
  }
  throw new Error(KEYS_NOT_SAVABLE);
}

/**
 * A key file holding `json`, or undefined where there is no keyring to
 * encrypt with (a Linux desktop without one, or CI).
 */
function encodeKeyFile(json: string): string | undefined {
  if (is.dev) {
    return json;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined;
  }
  return safeStorage.encryptString(json).toString("base64");
}

/**
 * A key store's `serialize`. Where there is no keyring to encrypt with (a
 * Linux desktop without one, or a launch its keyring was not reachable in),
 * it answers what the file in `dir` already holds, so the write the store
 * makes puts back the same bytes: a file encrypted on a launch that had the
 * keyring is still there, whole, on the next one that does. Nothing where
 * there is no file yet, since the store writes its defaults on the first
 * read at boot and throwing there would keep the app from opening. What was
 * being saved lasts until the app quits.
 */
export function keyFileSerializer({
  dir,
  log,
  name,
}: {
  /** The keys folder the store's file is in, read when a write happens. */
  dir: () => string;
  log: { error: (...data: unknown[]) => void };
  /** The store's name, one of `KEY_STORE_NAMES`. */
  name: string;
}): (value: unknown) => string {
  return (value) => {
    const encoded = encodeKeyFile(JSON.stringify(value));
    if (encoded !== undefined) {
      return encoded;
    }
    log.error("Encryption is not available");
    try {
      // oxlint-disable-next-line studio/no-sync-content-read -- a store's serialize is synchronous, and the keys folder is in this computer's machine folder, never a synced one
      return fs.readFileSync(path.join(dir(), keyFileName(name)), "utf8");
    } catch {
      return "";
    }
  };
}

/**
 * A key store's `deserialize`: `parse` reads the decoded JSON, and a file
 * that can't be decoded or parsed answers `fallback()`, empty. The store
 * answers from memory while its file is unchanged (`stores/store.ts`), and
 * a failed file is also remembered by its contents, for a read that memory
 * does not answer: the failure is logged once, with `lost` (what the person finds
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
