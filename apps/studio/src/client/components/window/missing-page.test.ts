import { describe, expect, it } from "vitest";

import { askedAddressOf, missingHref } from "./missing-page";
import { matchScreen } from "./window-href";

describe("a page that doesn't exist", () => {
  it.each([
    "instrument://nowhere",
    "instrument://nowhere/x?y=1&z=two words",
    "instrument-dev://debug/components",
  ])("stands at %s, which it says back", (address) => {
    const href = missingHref(address);
    expect(matchScreen(href).kind).toBe("unknown");
    expect(askedAddressOf(href)).toBe(address);
  });

  it.each(["/removed-page?from=older-build", "/apps/linear/settings"])(
    "says %s, a tab's own address no screen answers, as it is",
    (href) => {
      expect(askedAddressOf(href)).toBe(href);
    },
  );
});
