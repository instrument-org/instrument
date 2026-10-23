// Contract shared by the main process (browser-view manager) and the renderer
// (browser webview pool). The browser guest is a renderer `<webview>`; the main
// process drives it over CDP after grabbing the guest WebContents in
// `did-attach-webview`. The partition carries each guest's target id to the
// main process, which selects its workspace browser session in
// `will-attach-webview`.

import {
  type BrowserTargetId,
  BrowserTargetIdSchema,
} from "@instrument-org/workspace/client";

/**
 * The renderer sets the guest's `partition` to this prefix + the encoded target
 * id. `will-attach-webview` only surfaces recognized webview attributes (not
 * arbitrary `data-*`), so the partition string is how the renderer tells the
 * main process which target a guest belongs to. Main overrides the guest
 * session with the workspace browser profile (which takes precedence over a
 * partition string), so this partition value is just a carrier.
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
  // Whether the guest is asleep (BrowserEntry.asleep): the pool hides its
  // element so it draws nothing while no slot shows it.
  asleep: boolean;
  attached: boolean;
  // Per-entry generation (see BrowserEntry.generation). The id is stable across
  // a destroy+recreate of the same (task, session), so the pool diffs the
  // generation to know it must dispose the old guest and mount a fresh one.
  generation: number;
  id: BrowserTargetId;
  // Whether a real page has started loading in this guest (see
  // BrowserEntry.navigated). What the UI shows a browser for: an attached guest
  // that has only ever held `about:blank` is one nothing asked to see.
  navigated: boolean;
}

/**
 * How a tab's last page load ended: Chromium's net error for one that
 * failed, or the HTTP status of the response it committed.
 */
export type GuestLastLoad =
  | { errorCode: number; errorDescription: string; url: string }
  | { errorCode?: undefined; httpResponseCode: number; url: string };

/**
 * A page asking for a username and password (HTTP basic or digest auth, or a
 * proxy in its way), waiting on the person's answer in the tab's window.
 */
export interface GuestSignIn {
  id: string;
  /** A proxy between the guest and the site asked, rather than the site. */
  proxy: boolean;
  realm: string;
  /** The host the sign-in is for, with its port when not the default. */
  site: string;
  targetId: BrowserTargetId;
  /**
   * Whether the address asking is potentially trustworthy in Chromium's
   * terms (https, or localhost), where its dialog says nothing of privacy.
   */
  trustworthy: boolean;
}

/**
 * Whether a failed load's error code is a certificate error: Chromium's
 * `ERR_CERT_*` range, -200 down to -218 (`ERR_CERT_END` is -219).
 */
export function isCertificateError(errorCode: number): boolean {
  return errorCode <= -200 && errorCode > -219;
}

/**
 * Zoom range for the browser guest, matching desktop Chrome's 25%–500%. The
 * shared `steppedZoom` ladder (see `@/shared/zoom`) is restricted to this range
 * so the panel's zoom widget (renderer) and the keyboard shortcuts (main
 * process) step and clamp identically.
 */
export const BROWSER_ZOOM_MAX = 5;
export const BROWSER_ZOOM_MIN = 0.25;

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
