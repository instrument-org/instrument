/**
 * Which display protocol Electron talks on Linux.
 *
 * `auto` by default, resolved here to a concrete platform rather than left to
 * Chromium. An absent `--ozone-platform` selects Chromium's compiled-in
 * default, which is X11, and `--ozone-platform-hint=auto` does not select one
 * either. Both leave a Wayland desktop running the app through XWayland, where
 * a file dragged out of the app reaches nothing, because Chromium's
 * browser-process-initiated drag does not cross the XWayland bridge that a GTK
 * app's does (see docs/findings/drag-out-does-not-cross-xwayland.md).
 *
 * `WAYLAND_DISPLAY` is the signal that a session is Wayland, and the switch is
 * set from it on every launch, so the platform the process runs on is always
 * one the app named and logged.
 *
 * `INSTRUMENT_OZONE_PLATFORM` overrides the choice, and `x11` is the way back
 * for anyone a Wayland problem finds. Passing `--ozone-platform` on the command
 * line does not work, because the switch the app sets is applied after the
 * process command line is parsed and overwrites it.
 */
export const OZONE_PLATFORMS = ["auto", "wayland", "x11"] as const;

export type DisplayProtocol = "wayland" | "x11";

export interface OzoneChoice {
  /** A requested value that is not a platform, kept so the caller can say so. */
  ignored?: string;
  platform: OzonePlatform;
}

export type OzonePlatform = (typeof OZONE_PLATFORMS)[number];

/**
 * What the app ended up talking, which the request alone does not answer.
 *
 * Anything conditional on the protocol wants this rather than the request. A
 * frameless window is decorated by the compositor under Wayland and by nothing
 * at all under X11, so what the app must draw for itself differs, and so does
 * the client-area geometry it gets.
 */
export function effectiveDisplayProtocol(
  platform: OzonePlatform,
  waylandDisplay: string | undefined = process.env.WAYLAND_DISPLAY,
  appliedSwitch?: string,
): DisplayProtocol {
  // A switch that survived outranks the session, because it is not a guess: a
  // run carrying `x11` is talking X11 whatever `WAYLAND_DISPLAY` says.
  if (appliedSwitch === "wayland" || appliedSwitch === "x11") {
    return appliedSwitch;
  }
  return ozonePlatformSwitch(platform, waylandDisplay);
}

/**
 * The value to give `--ozone-platform`, which has to name a real platform:
 * Chromium rejects `auto` fatally at startup, and leaving the switch off picks
 * X11 rather than anything that reads the session.
 */
export function ozonePlatformSwitch(
  platform: OzonePlatform,
  waylandDisplay: string | undefined = process.env.WAYLAND_DISPLAY,
): DisplayProtocol {
  if (platform === "auto") {
    return waylandDisplay ? "wayland" : "x11";
  }
  return platform;
}

export function resolveOzonePlatform(
  requested: string | undefined,
): OzoneChoice {
  if (!requested) {
    return { platform: "auto" };
  }

  const match = OZONE_PLATFORMS.find((value) => value === requested);
  return match ? { platform: match } : { ignored: requested, platform: "auto" };
}
