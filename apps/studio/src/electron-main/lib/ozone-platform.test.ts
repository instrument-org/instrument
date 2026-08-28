import { describe, expect, it } from "vitest";

import { resolveOzonePlatform } from "./ozone-platform";

describe("resolveOzonePlatform", () => {
  // Electron's own default, and the reason the switch is removed rather than
  // set: a Wayland session gets native Wayland, an X11 session gets X11.
  it("leaves the platform to Electron when nothing asks otherwise", () => {
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
