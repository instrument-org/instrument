import { type LiveEvent } from "../../rpc/publisher";

/**
 * Every synced store there is, and how a change to it, made here or on
 * another device, reaches what shows it. A store not listed here cannot be
 * opened, read or written, so a new one says this before it has any data:
 *
 * - `event`: what the workspace says when it changes (`live-changes.ts`),
 *   which every list showing it reads again on. `live-changes.test.ts`
 *   writes a line as another device and waits for the event.
 * - `host`: the host opens the store and tells its windows itself.
 * - `unshown`: nothing on screen is read from it.
 */
export const SYNCED_DOMAINS = {
  apps: { event: "app.updated" },
  bookmarks: { host: true },
  chatfoldermoves: { unshown: true },
  memory: { event: "memory.changed" },
  projects: { event: "project.changed" },
} as const satisfies Record<
  string,
  { event: LiveEvent } | { host: true } | { unshown: true }
>;

/** A synced store's name, and its file's. */
export type SyncedDomain = keyof typeof SYNCED_DOMAINS;
