/**
 * Which display protocol Electron talks on Linux.
 *
 * `auto` by default, which is Electron's own default since 38: native Wayland
 * in a Wayland session, X11 in an X11 one. The app pinned `x11` instead until
 * 2026-08-28, so every Linux user on a Wayland desktop ran through XWayland,
 * and a file dragged out of the app reached nothing -- Chromium's
 * browser-process-initiated drag does not cross the XWayland bridge that a GTK
 * app's does (see docs/findings/drag-out-does-not-cross-xwayland.md).
 *
 * `INSTRUMENT_OZONE_PLATFORM` overrides it, and `x11` is the way back for
 * anyone a Wayland problem finds. Passing `--ozone-platform` on the command
 * line does not work, because the switch the app sets is applied after the
 * process command line is parsed and overwrites it.
 *
 * `auto` is the odd one to implement. It is not a platform Chromium accepts:
 * passing it is fatal at startup with `Invalid ozone platform: auto`. It is the
 * name of what Chromium does when the flag is absent, so asking for it means
 * taking the flag away rather than setting it.
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
 * What the app ended up talking, which `auto` on its own does not answer: it
 * asks Chromium to choose, and Chromium chooses Wayland when the session offers
 * one. `WAYLAND_DISPLAY` is the same signal Chromium reads.
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
  // A switch that survived outranks everything else, because it is not a guess:
  // `removeSwitch` does not always undo a `--ozone-platform` the process was
  // started with, and a run that asked for `auto` and still carries `x11` is
  // talking X11 whatever `WAYLAND_DISPLAY` says.
  if (appliedSwitch === "wayland" || appliedSwitch === "x11") {
    return appliedSwitch;
  }
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
