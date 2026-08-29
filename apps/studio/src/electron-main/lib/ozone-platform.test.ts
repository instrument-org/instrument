import { describe, expect, it } from "vitest";

import {
  effectiveDisplayProtocol,
  OZONE_PLATFORMS,
  ozonePlatformSwitch,
  resolveOzonePlatform,
} from "./ozone-platform";

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
    expect(ozonePlatformSwitch("auto", "wayland-0")).toBe("wayland");
    expect(ozonePlatformSwitch("auto", undefined)).toBe("x11");
    expect(ozonePlatformSwitch("auto", "")).toBe("x11");
  });

  it("never yields a value Chromium would reject", () => {
    for (const platform of OZONE_PLATFORMS) {
      for (const display of ["wayland-0", undefined]) {
        expect(["wayland", "x11"]).toContain(
          ozonePlatformSwitch(platform, display),
        );
      }
    }
  });

  it("passes a pinned platform through, session or not", () => {
    expect(ozonePlatformSwitch("x11", "wayland-0")).toBe("x11");
    expect(ozonePlatformSwitch("wayland", undefined)).toBe("wayland");
  });
});

describe("effectiveDisplayProtocol", () => {
  // The case the whole function exists for: `auto` is a request, and only the
  // session says what it turned into.
  it("reads the session when the platform is left to Electron", () => {
    expect(effectiveDisplayProtocol("auto", "wayland-0")).toBe("wayland");
    expect(effectiveDisplayProtocol("auto", undefined)).toBe("x11");
    expect(effectiveDisplayProtocol("auto", "")).toBe("x11");
  });

  // A pin wins over the session, which is the point of pinning: a Wayland
  // desktop running the app on x11 is exactly what INSTRUMENT_OZONE_PLATFORM
  // is for, and it must not be reported as Wayland.
  it.each([
    { platform: "x11", waylandDisplay: "wayland-0" },
    { platform: "x11", waylandDisplay: undefined },
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
    expect(effectiveDisplayProtocol("auto", undefined, "wayland")).toBe(
      "wayland",
    );
  });

  it("ignores a switch value that is not a protocol", () => {
    expect(effectiveDisplayProtocol("auto", "wayland-0", "")).toBe("wayland");
    expect(effectiveDisplayProtocol("auto", "wayland-0", "auto")).toBe(
      "wayland",
    );
    expect(effectiveDisplayProtocol("auto", undefined, "nonsense")).toBe("x11");
  });

  it("reports wayland when it is pinned, session or not", () => {
    expect(effectiveDisplayProtocol("wayland", undefined)).toBe("wayland");
    expect(effectiveDisplayProtocol("wayland", "wayland-0")).toBe("wayland");
  });
});
