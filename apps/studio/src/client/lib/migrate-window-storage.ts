/**
 * Rewrites what the window keeps in `localStorage` into the shape this build
 * reads, for state an older build wrote:
 *
 * - While a chat was called a thread: tab addresses under
 *   `/orchestrator/threads`, a Tasks screen's `?thread=`, and a small view's
 *   `kind: "thread"`.
 * - While the window's routes lived under `/orchestrator`: every screen's
 *   address, including the ones that took a new name (`computer` is `/files`,
 *   `web` is `/browser`, `ideas` is `/discover`, `home` is `/new-tab`, a site's
 *   `page?group=site:<id>` is `/sites/<id>`, and the inbox is `/chats`).
 * - While the window's keys had an `orchestrator.` namespace of their own,
 *   apart from the classic window's `studio.` one: each moves to `studio.`,
 *   under the name its atom has now, once the classic window's own keys are
 *   gone from under it.
 *
 * Runs as a side effect of being imported, by each module that defines one of
 * the window's stored atoms, because those atoms read their stored value as
 * their modules load. Not from the renderer's entry: in a build the entry's own
 * code evaluates after the chunks it imports, so the atoms would read the old
 * keys first and write their defaults over what this moves.
 *
 * Runs on every launch and changes nothing once there is nothing under the old
 * names. A value under an old name is dropped when its new name already holds
 * one, which a build that already migrated wrote and is the newer of the two.
 *
 * Only addresses are rewritten, and only where a stored string starts with
 * one, so a web page's own address that happens to hold `/orchestrator` or
 * `thread=` is left as it is.
 */
const REWRITES: [RegExp, string][] = [
  [/(?<=")\/orchestrator\/threads\b/g, "/orchestrator/chats"],
  [/(?<="\/orchestrator[^"]*[?&])thread=/g, "chat="],
  [/"kind":"thread"/g, '"kind":"chat"'],
  [/(?<=")\/orchestrator\/page\?group=site(?:%3A|:)([\w-]+)/g, "/sites/$1"],
  [/(?<=")\/orchestrator\/computer\b/g, "/files"],
  [/(?<=")\/orchestrator\/web\b/g, "/browser"],
  [/(?<=")\/orchestrator\/ideas\b/g, "/discover"],
  [/(?<=")\/orchestrator\/home\b/g, "/new-tab"],
  [
    /(?<=")\/orchestrator\/(apps|chats|memory|release-notes|skills|tasks)\b/g,
    "/$1",
  ],
  [/(?<=")\/orchestrator\/?(?=["?#])/g, "/chats"],
];

/** What the classic window kept, which nothing reads any more. */
const CLASSIC_KEYS = [
  "studio.projects-section-open.v1",
  "studio.sidebar-open.v1",
  "studio.sidebar-width.v1",
  "studio.tabs.v1",
  "studio.task-pane-share.v1",
];

/** The keys whose name changed with the namespace; every other one keeps its own. */
const RENAMED_KEYS: Record<string, string> = {
  "orchestrator.sidebar-width.v1": "studio.inbox-width.v1",
  "orchestrator.tabs.v8": "studio.window-tabs.v8",
};

const FORMER_PREFIX = "orchestrator.";

export function migrateWindowStorage(storage: Storage) {
  for (const key of CLASSIC_KEYS) {
    storage.removeItem(key);
  }
  const former: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(FORMER_PREFIX)) {
      former.push(key);
    }
  }
  for (const key of former) {
    const value = storage.getItem(key);
    storage.removeItem(key);
    const next =
      RENAMED_KEYS[key] ?? `studio.${key.slice(FORMER_PREFIX.length)}`;
    // A value under the new name was written by a build that already
    // migrated, and is the newer of the two.
    if (value === null || storage.getItem(next) !== null) {
      continue;
    }
    let migrated = value;
    for (const [pattern, replacement] of REWRITES) {
      migrated = migrated.replace(pattern, replacement);
    }
    storage.setItem(next, migrated);
  }
}

try {
  migrateWindowStorage(localStorage);
} catch {
  // Storage that cannot be read or written leaves the window's state as it
  // was, which each atom's own validation already survives.
}
