import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, net: {} }));

const { newestFullRelease } = await import("./update-bridge");

const feed = (...assets: { Type: string; Version: string }[]) => ({
  Assets: assets.map((asset) => ({ FileName: "x.nupkg", ...asset })),
});

describe("newestFullRelease", () => {
  it("offers the newest full release, deltas aside", () => {
    expect(
      newestFullRelease(
        feed(
          { Type: "Full", Version: "2.0.1" },
          { Type: "Full", Version: "2.0.3" },
          { Type: "Delta", Version: "2.0.4" },
        ),
        "2.0.1",
      ),
    ).toBe("2.0.3");
  });

  it("offers the running version itself, which the move reinstalls", () => {
    expect(
      newestFullRelease(
        feed({ Type: "Full", Version: "2.0.0-beta.111" }),
        "2.0.0-beta.111",
      ),
    ).toBe("2.0.0-beta.111");
  });

  it("never offers an older version", () => {
    expect(
      newestFullRelease(
        feed({ Type: "Full", Version: "2.0.0-beta.110" }),
        "2.0.0-beta.111",
      ),
    ).toBeUndefined();
  });

  it.each([
    ["no assets", {}],
    ["not an object", "nope"],
    ["an invalid version", feed({ Type: "Full", Version: "latest" })],
  ])("offers nothing for %s", (_name, value) => {
    expect(newestFullRelease(value, "1.0.0")).toBeUndefined();
  });
});
