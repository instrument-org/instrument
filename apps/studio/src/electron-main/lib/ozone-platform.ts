/**
 * Which display protocol Electron talks on Linux.
 *
 * `x11` by default, so a Wayland desktop runs the app through XWayland. That is
 * a workaround for Wayland problems Electron has not finished with, and it has
 * its own price: a drag out of the app never reaches a native Wayland client,
 * because Chromium's browser-process-initiated drag does not cross the bridge a
 * GTK app's does (see docs/findings/drag-out-does-not-cross-xwayland.md).
 *
 * `INSTRUMENT_OZONE_PLATFORM` is how that gets tested without a code change.
 * Passing `--ozone-platform` on the command line does not work, because the
 * switch the app sets is applied after the process command line is parsed and
 * overwrites it.
 *
 * `auto` is the odd one. It is Electron's own default since 38, and means
 * native Wayland in a Wayland session, but it is not a platform Chromium
 * accepts: passing it is fatal at startup with `Invalid ozone platform: auto`.
 * It is the name of what Chromium does when the flag is absent, so asking for
 * it means taking the flag away rather than setting it -- including the one the
 * packaged launcher puts on argv.
 */
export const OZONE_PLATFORMS = ["auto", "wayland", "x11"] as const;

export interface OzoneChoice {
  /** A requested value that is not a platform, kept so the caller can say so. */
  ignored?: string;
  platform: OzonePlatform;
}

export type OzonePlatform = (typeof OZONE_PLATFORMS)[number];

export function resolveOzonePlatform(
  requested: string | undefined,
): OzoneChoice {
  if (!requested) {
    return { platform: "x11" };
  }

  const match = OZONE_PLATFORMS.find((value) => value === requested);
  return match ? { platform: match } : { ignored: requested, platform: "x11" };
}
