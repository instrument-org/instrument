import { describe, expect, it } from "vitest";

import { getAssetUrl } from "./get-asset-url";

describe("getAssetUrl", () => {
  it.each([
    ["output/image.png", "http://assets.task.localhost/output/image.png"],
    ["./output/image.png", "http://assets.task.localhost/output/image.png"],
    ["/mnt/Photos/cat.png", "http://assets.task.localhost/mnt/Photos/cat.png"],
  ])("joins %s to the asset origin", (filePath, expected) => {
    expect(
      getAssetUrl({
        assetBase: "http://assets.task.localhost",
        filePath,
      }),
    ).toBe(expected);
  });

  it("adds the cache-busting version", () => {
    expect(
      getAssetUrl({
        assetBase: "http://assets.task.localhost",
        filePath: "output/cat.png",
        version: 123,
      }),
    ).toBe("http://assets.task.localhost/output/cat.png?version=123");
  });

  // The client appends the version for any path; the asset server decides cache
  // policy (mounts are always served no-store, so a mount version is inert).
  it("appends the version to a mount path too", () => {
    expect(
      getAssetUrl({
        assetBase: "http://assets.task.localhost",
        filePath: "/mnt/Photos/cat.png",
        version: 123,
      }),
    ).toBe("http://assets.task.localhost/mnt/Photos/cat.png?version=123");
  });
});
