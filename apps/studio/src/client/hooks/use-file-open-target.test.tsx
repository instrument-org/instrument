import { describe, expect, it } from "vitest";

import { sharedApps } from "./use-file-open-target";

const app = (name: string, isDefault = false) => ({
  appName: name,
  appPath: `/Applications/${name}.app`,
  iconUrl: null,
  isDefault,
});

describe("sharedApps", () => {
  it("keeps the apps every file opens in, the default only where it is every one's", () => {
    expect(
      sharedApps([
        [app("Preview", true), app("Safari"), app("Zed")],
        [app("Zed", true), app("Preview")],
      ]).map((each) => [each.appName, each.isDefault]),
    ).toMatchInlineSnapshot(`
      [
        [
          "Preview",
          false,
        ],
        [
          "Zed",
          false,
        ],
      ]
    `);
  });

  it("keeps the default when every file shares it", () => {
    expect(
      sharedApps([[app("Zed", true)], [app("Zed", true), app("Preview")]]),
    ).toEqual([app("Zed", true)]);
  });
});
