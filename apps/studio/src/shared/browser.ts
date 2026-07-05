// Contract shared by the main process (browser-view manager) and the renderer
// (browser webview pool). The browser guest is a renderer `<webview>`; the main
// process drives it over CDP after grabbing the guest WebContents in
// `did-attach-webview`, and keeps per-task isolation by overriding the guest
// session in `will-attach-webview`.

import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
} from "@instrument-org/workspace/client";

/**
 * The renderer sets the guest's `partition` to this prefix + the encoded target
 * id. `will-attach-webview` only surfaces recognized webview attributes (not
 * arbitrary `data-*`), so the partition string is how the renderer tells the
 * main process which target a guest belongs to. Main then overrides the guest
 * session with `session.fromPath(partitionDir)` (which takes precedence over a
 * partition string), so the guest keeps the same on-disk, per-task profile; this
 * partition value is just a carrier.
 */
const BROWSER_PARTITION_PREFIX = "persist:browser-route:";

/**
 * Logical guest viewport. Kept fixed across visibility modes so the browser's
 * capture/screencast surface is stable; the visible tab scales it to fit.
 */
export const BROWSER_GUEST_VIEWPORT = { height: 800, width: 1280 };

/**
 * A recorded browser target and whether its guest has attached yet. Streamed
 * over `browser.live.targets`: the pool mounts a `<webview>` for every id
 * (attached or not -- mounting is what triggers the attach), while the UI treats
 * only attached targets as "live" (guest present, not a placeholder).
 */
export interface BrowserGuestTarget {
  attached: boolean;
  // Per-entry generation (see BrowserEntry.generation). The id is stable across
  // a destroy+recreate of the same (task, session), so the pool diffs the
  // generation to know it must dispose the old guest and mount a fresh one.
  generation: number;
  id: BrowserTargetId;
}

export function browserPartition(targetId: BrowserTargetId): string {
  // Encode so the target id's `/` doesn't complicate the partition string.
  return `${BROWSER_PARTITION_PREFIX}${encodeURIComponent(targetId)}`;
}

export function targetIdFromPartition(
  partition: string | undefined,
): BrowserTargetId | null {
  if (!partition?.startsWith(BROWSER_PARTITION_PREFIX)) {
    return null;
  }
  let raw: string;
  try {
    raw = decodeURIComponent(partition.slice(BROWSER_PARTITION_PREFIX.length));
  } catch {
    // Malformed percent-encoding: not a partition we produced. Return null so
    // the main-process attach handler leaves the webview alone instead of
    // throwing out of `will-attach-webview`.
    return null;
  }
  const result = BrowserTargetIdSchema.safeParse(raw);
  return result.success ? result.data : null;
}
