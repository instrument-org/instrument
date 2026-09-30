/**
 * Rewrites what the 2.0 window kept in `localStorage` while a chat was called
 * a thread: tab addresses under `/orchestrator/threads`, a Tasks screen's
 * `?thread=`, and a small view's `kind: "thread"`. Runs as a side effect of
 * being imported by each module that defines a stored 2.0 atom, because those
 * atoms read their value as their modules load. Imported from the renderer's
 * entry instead, it runs too late in a build: the entry's own code evaluates
 * after the chunks it imports, and the atoms live in those chunks.
 *
 * Idempotent, so it runs on every launch and a value written by an older
 * build run in between is caught on the next one.
 */
const REWRITES: [RegExp, string][] = [
  [/\/orchestrator\/threads\b/g, "/orchestrator/chats"],
  [/([?&])thread=/g, "$1chat="],
  [/"kind":"thread"/g, '"kind":"chat"'],
];

export function renameChatStorage(storage: Storage) {
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith("orchestrator.")) {
      continue;
    }
    const value = storage.getItem(key);
    if (value === null) {
      continue;
    }
    let renamed = value;
    for (const [pattern, replacement] of REWRITES) {
      renamed = renamed.replace(pattern, replacement);
    }
    if (renamed !== value) {
      storage.setItem(key, renamed);
    }
  }
}

try {
  renameChatStorage(localStorage);
} catch {
  // Storage that cannot be read or written leaves the window's state as it
  // was, which each atom's own validation already survives.
}
