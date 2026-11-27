import { describe, expect, it } from "vitest";

import { steppedOverMatches } from "./spotlight-matches";

describe("steppedOverMatches", () => {
  const skips = new Set([
    "/Users/mac-user/Documents",
    "/Users/mac-user/Downloads",
    "/Users/mac-user/Library",
    "/Users/mac-user/Library/Containers",
    "/Users/mac-user/Library/Mobile Documents",
  ]);

  it("keeps matches in the folders a walk from home stepped over", () => {
    expect(
      steppedOverMatches(
        [
          "/Users/mac-user/Documents/pricing.md",
          "/Users/mac-user/Documents/Notes/pricing-notes.md",
          "/Users/mac-user/Projects/pricing-top.md",
          "/Users/mac-user/Library/Caches/pricing.json",
          "/Users/mac-user/Library/Containers/app/pricing.db",
          "/Users/mac-user/Documents/.hidden/pricing.md",
          "/Users/mac-user/Documents/site/node_modules/pricing/index.js",
          "/Users/mac-user/Downloads/Pricing.app/Contents/pricing.plist",
          "/Users/mac-user/Downloads/Pricing.app",
          "/Applications/Pricing.app",
          "/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs/pricing.pdf",
          "/Users/mac-user/Library/Mobile Documents/iCloud~com~apple~clips/Documents/pricing.plist",
        ],
        { root: "/Users/mac-user", skips },
      ),
    ).toEqual([
      "/Users/mac-user/Documents/pricing.md",
      "/Users/mac-user/Documents/Notes/pricing-notes.md",
      "/Users/mac-user/Downloads/Pricing.app",
      "/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs/pricing.pdf",
    ]);
  });

  it("keeps nothing for a walk that went into the folder itself", () => {
    expect(
      steppedOverMatches(["/Users/mac-user/Documents/pricing.md"], {
        root: "/Users/mac-user/Documents",
        skips,
      }),
    ).toEqual([]);
  });
});
