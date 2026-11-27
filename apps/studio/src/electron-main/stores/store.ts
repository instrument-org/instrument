// oxlint-disable-next-line no-restricted-imports -- the one module that makes an electron-store
import ElectronStore from "electron-store";
import fs from "node:fs";

/** Whether a store's reads of its file may be remembered; none until the app is ready. */
let remembers: (file: string) => boolean = () => false;

/**
 * Lets the stores answer reads from memory, those whose file `canRemember`
 * accepts. Called once the app is ready: before then a key file can't be
 * decrypted, and its store answers empty, so those reads must not be
 * remembered.
 */
export function rememberStoreReads(
  canRemember: (file: string) => boolean,
): void {
  remembers = canRemember;
}

/** The file's identity, size and modification time, or nothing where it is missing. */
function stampOf(file: string): string | undefined {
  const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
  return stat && `${stat.ino}:${stat.size}:${stat.mtimeNs}`;
}

/**
 * electron-store, whose reads come from memory while the file is the one it
 * last read or wrote. electron-store reads, decrypts and deserializes (Zod,
 * for every store here) the whole file on every `get`; this one checks the
 * file's stamp instead, so a write from anywhere else (another instance of
 * the app on the same folder, a migration, an edit by hand) is still read.
 *
 * Every read answers its own copy, as electron-store's do, since `set`
 * changes the object it read and change listeners compare old and new. A
 * write moves the stamp, so the read after it goes through the store's own
 * deserialize, as a read of a value written elsewhere does.
 */
export default class Store<
  // electron-store's own constraint, which the stores' interfaces satisfy.
  // oxlint-disable-next-line typescript/no-explicit-any
  T extends Record<string, any>,
> extends ElectronStore<T> {
  // Declared without an initializer: electron-store reads and may write the
  // store while its constructor runs, before a field initializer would.
  declare private last: undefined | { stamp: string | undefined; value: T };

  override get store(): T {
    if (!remembers(this.path)) {
      this.last = undefined;
      return super.store;
    }
    // Stamped before reading, so a write landing in between is read again.
    const stamp = stampOf(this.path);
    if (this.last && this.last.stamp === stamp) {
      return structuredClone(this.last.value);
    }
    const value = super.store;
    this.last = { stamp, value: structuredClone(value) };
    return value;
  }

  // A getter overridden alone would leave the store with no setter.
  override set store(value: T) {
    super.store = value;
  }
}
