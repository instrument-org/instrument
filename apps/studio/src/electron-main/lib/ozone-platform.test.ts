import { describe, expect, it } from "vitest";

import {
  effectiveDisplayProtocol,
  OZONE_PLATFORMS,
  ozonePlatformSwitch,
  resolveOzonePlatform,
} from "./ozone-platform";

/**
 * How a test says an environment variable is absent.
 *
 * A literal `undefined` cannot say it: these parameters default to
 * `process.env`, and JavaScript applies a default whenever the argument is
 * `undefined`, so passing it hands the function the real environment and the
 * result follows whichever session the test happens to run in. An empty string
 * is falsy, is not a protocol name, and takes the same branch an absent
 * variable does.
 */
const UNSET = "";

describe("resolveOzonePlatform", () => {
  // `auto` is a request to read the session, resolved before the switch is set
  // rather than handed to Chromium, which rejects it.
  it("asks for the session's own platform when nothing says otherwise", () => {
    expect(resolveOzonePlatform(undefined)).toEqual({ platform: "auto" });
    expect(resolveOzonePlatform("")).toEqual({ platform: "auto" });
  });

  it.each(["auto", "wayland", "x11"])("takes %s", (requested) => {
    expect(resolveOzonePlatform(requested)).toEqual({ platform: requested });
  });

  // Anything Chromium would reject has to be caught here, because it does not
  // reject it politely: an unknown platform is fatal at startup, before any
  // window exists, and the app is simply gone.
  it.each(["", "  ", "X11", "wayland ", "hint", "headless", "nonsense"])(
    "falls back to the default rather than passing on %o",
    (requested) => {
      const choice = resolveOzonePlatform(requested);

      expect(choice.platform).toBe("auto");
      if (requested) {
        expect(choice.ignored).toBe(requested);
      }
    },
  );
});

describe("ozonePlatformSwitch", () => {
  // The bug this function exists for. Leaving `--ozone-platform` off does not
  // ask Chromium to read the session; it selects Chromium's compiled-in
  // default, which is X11. A Wayland desktop then ran the app through
  // XWayland while the log claimed otherwise, and on a host whose XWayland
  // presenter is broken the window never appeared at all.
  it("names a real platform for the session when the request is auto", () => {
    expect(ozonePlatformSwitch("auto", "wayland-0", UNSET)).toBe("wayland");
    expect(ozonePlatformSwitch("auto", UNSET, UNSET)).toBe("x11");
  });

  // Either signal answers for the session, because a launch context can carry
  // one and not the other. A desktop entry and an updater relaunch inherit
  // whatever their launcher held, and dropping `WAYLAND_DISPLAY` while keeping
  // `XDG_SESSION_TYPE` was enough to put a Wayland session back on XWayland,
  // where the window maps and never presents a frame.
  it.each([
    { expected: "wayland", sessionType: "wayland", waylandDisplay: UNSET },
    { expected: "wayland", sessionType: UNSET, waylandDisplay: "wayland-0" },
    { expected: "wayland", sessionType: "x11", waylandDisplay: "wayland-0" },
    { expected: "x11", sessionType: "x11", waylandDisplay: UNSET },
    { expected: "x11", sessionType: "tty", waylandDisplay: UNSET },
    { expected: "x11", sessionType: UNSET, waylandDisplay: UNSET },
  ] as const)(
    "resolves $expected from WAYLAND_DISPLAY=$waylandDisplay and XDG_SESSION_TYPE=$sessionType",
    ({ expected, sessionType, waylandDisplay }) => {
      expect(ozonePlatformSwitch("auto", waylandDisplay, sessionType)).toBe(
        expected,
      );
    },
  );

  it("never yields a value Chromium would reject", () => {
    for (const platform of OZONE_PLATFORMS) {
      for (const display of ["wayland-0", UNSET]) {
        for (const sessionType of ["wayland", "x11", UNSET]) {
          expect(["wayland", "x11"]).toContain(
            ozonePlatformSwitch(platform, display, sessionType),
          );
        }
      }
    }
  });

  it("passes a pinned platform through, session or not", () => {
    expect(ozonePlatformSwitch("x11", "wayland-0", "wayland")).toBe("x11");
    expect(ozonePlatformSwitch("wayland", UNSET, "x11")).toBe("wayland");
  });
});

describe("effectiveDisplayProtocol", () => {
  // The case the whole function exists for: `auto` is a request, and only the
  // session says what it turned into.
  it("reads the session when the platform is left to Electron", () => {
    expect(effectiveDisplayProtocol("auto", "wayland-0", UNSET, UNSET)).toBe(
      "wayland",
    );
    expect(effectiveDisplayProtocol("auto", UNSET, UNSET, UNSET)).toBe("x11");
    expect(effectiveDisplayProtocol("auto", UNSET, UNSET, "wayland")).toBe(
      "wayland",
    );
  });

  // A pin wins over the session, which is the point of pinning: a Wayland
  // desktop running the app on x11 is exactly what INSTRUMENT_OZONE_PLATFORM
  // is for, and it must not be reported as Wayland.
  it.each([
    { platform: "x11", waylandDisplay: "wayland-0" },
    { platform: "x11", waylandDisplay: UNSET },
  ] as const)(
    "reports $platform when it is pinned",
    ({ platform, waylandDisplay }) => {
      expect(effectiveDisplayProtocol(platform, waylandDisplay)).toBe(platform);
    },
  );

  // A packaged 1.6.6 launched with --ozone-platform=x11 resolved to `auto`,
  // logged `auto`, and ran as an X11 client: removeSwitch did not undo the
  // argv flag. Trusting WAYLAND_DISPLAY there hid the window border on a
  // window Electron had drawn no edge for.
  it("lets a switch that survived outrank the session", () => {
    expect(effectiveDisplayProtocol("auto", "wayland-0", "x11")).toBe("x11");
    expect(effectiveDisplayProtocol("auto", UNSET, "wayland")).toBe("wayland");
  });

  it("ignores a switch value that is not a protocol", () => {
    expect(effectiveDisplayProtocol("auto", "wayland-0", "")).toBe("wayland");
    expect(effectiveDisplayProtocol("auto", "wayland-0", "auto")).toBe(
      "wayland",
    );
    expect(effectiveDisplayProtocol("auto", UNSET, "nonsense", UNSET)).toBe(
      "x11",
    );
  });

  it("reports wayland when it is pinned, session or not", () => {
    expect(effectiveDisplayProtocol("wayland", UNSET)).toBe("wayland");
    expect(effectiveDisplayProtocol("wayland", "wayland-0")).toBe("wayland");
  });
});
