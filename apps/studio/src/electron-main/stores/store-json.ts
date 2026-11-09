/**
 * The JSON a store's file holds, for its `deserialize`, or nothing where the
 * file is not JSON: one cut short by a power loss or a full disk, or edited
 * by hand. The store's schema then fails on it as it does on any shape it
 * does not know, and the store answers its defaults.
 *
 * A bare `JSON.parse` there throws out of every read of the store, and the
 * stores read while the app starts would stop it from opening at all, at
 * every launch, until someone deleted the file.
 */
export function storeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
