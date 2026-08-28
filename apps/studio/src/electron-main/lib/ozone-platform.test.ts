import { describe, expect, it } from "vitest";

import { resolveOzonePlatform } from "./ozone-platform";

describe("resolveOzonePlatform", () => {
  it("pins x11 when nothing asks otherwise", () => {
    expect(resolveOzonePlatform(undefined)).toEqual({ platform: "x11" });
    expect(resolveOzonePlatform("")).toEqual({ platform: "x11" });
  });

  it.each(["auto", "wayland", "x11"])("takes %s", (requested) => {
    expect(resolveOzonePlatform(requested)).toEqual({ platform: requested });
  });

  // Anything Chromium would reject has to be caught here, because it does not
  // reject it politely: an unknown platform is fatal at startup, before any
  // window exists, and the app is simply gone.
  it.each(["", "  ", "X11", "wayland ", "hint", "headless", "nonsense"])(
    "falls back to x11 rather than passing on %o",
    (requested) => {
      const choice = resolveOzonePlatform(requested);

      expect(choice.platform).toBe("x11");
      if (requested) {
        expect(choice.ignored).toBe(requested);
      }
    },
  );
});
