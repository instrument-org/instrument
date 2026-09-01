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
 * `WAYLAND_DISPLAY` and `XDG_SESSION_TYPE` are the signals that a session is
 * Wayland, and the switch is set from them on every launch, so the platform the
 * process runs on is always one the app named and logged. Either one is enough,
 * because a launch context can carry one and not the other: a desktop entry and
 * an updater relaunch inherit whatever their launcher held, and losing
 * `WAYLAND_DISPLAY` alone is sufficient to put a Wayland session back on
 * XWayland, which is where the window can map and never present a frame.
 * Naming Wayland without `WAYLAND_DISPLAY` costs nothing: Chromium falls back
 * to the default socket name, which is the one a session of that type has.
 *
 * `INSTRUMENT_OZONE_PLATFORM` overrides the choice, and `x11` is the way back
 * for anyone a Wayland problem finds. A `--ozone-platform` already on the
 * command line outranks both, because the browser process has taken it before
 * any of this runs and only its children would follow a different one.
 */
export const OZONE_PLATFORMS = ["auto", "wayland", "x11"] as const;

export type DisplayProtocol = "wayland" | "x11";

export interface OzoneChoice {
  /** A requested value that is not a platform, kept so the caller can say so. */
  ignored?: string;
  platform: OzonePlatform;
}

export type OzonePlatform = (typeof OZONE_PLATFORMS)[number];

/** What to put on the command line, and what the process ends up talking. */
export interface OzoneDecision {
  /** The switch to append, or `null` when the command line already named one. */
  append: DisplayProtocol | null;
  /** The platform in force, which a command-line value can make anything. */
  platform: string;
}

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
  sessionType: string | undefined = process.env.XDG_SESSION_TYPE,
): DisplayProtocol {
  // A switch that survived outranks the session, because it is not a guess: a
  // run carrying `x11` is talking X11 whatever the session signals say.
  if (appliedSwitch === "wayland" || appliedSwitch === "x11") {
    return appliedSwitch;
  }
  return ozonePlatformSwitch(platform, waylandDisplay, sessionType);
}

/**
 * The value to give `--ozone-platform`, which has to name a real platform:
 * Chromium rejects `auto` fatally at startup, and leaving the switch off picks
 * X11 rather than anything that reads the session.
 */
export function ozonePlatformSwitch(
  platform: OzonePlatform,
  waylandDisplay: string | undefined = process.env.WAYLAND_DISPLAY,
  sessionType: string | undefined = process.env.XDG_SESSION_TYPE,
): DisplayProtocol {
  if (platform === "auto") {
    return waylandDisplay || sessionType === "wayland" ? "wayland" : "x11";
  }
  return platform;
}

/**
 * What to give `--ozone-platform`, given what the command line already holds.
 *
 * The browser process reads its own `--ozone-platform` before this file runs,
 * and appending a different one only reaches the processes it spawns. The
 * browser then talks one protocol while its renderers are told another, and the
 * window maps and never presents a frame: a full-screen blank surface that
 * moves, closes, and logs nothing wrong. So a value already on the command line
 * decides, whatever it says and whatever the session or the environment
 * variable asked for.
 */
export function decideOzonePlatform(
  requested: OzonePlatform,
  commandLine: string | undefined,
  waylandDisplay: string | undefined = process.env.WAYLAND_DISPLAY,
  sessionType: string | undefined = process.env.XDG_SESSION_TYPE,
): OzoneDecision {
  if (commandLine) {
    return { append: null, platform: commandLine };
  }
  const platform = ozonePlatformSwitch(requested, waylandDisplay, sessionType);
  return { append: platform, platform };
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
