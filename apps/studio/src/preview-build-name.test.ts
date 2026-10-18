import { describe, expect, it } from "vitest";

import {
  appFlavorOf,
  HOME_DATA_FOLDER_NAMES,
  homeFoldersOf,
  previewBuildNameOf,
} from "@instrument-org/shared/constants";

describe("homeFoldersOf", () => {
  it("gives each flavor its own home folders, one pair for every preview", () => {
    expect([
      homeFoldersOf({ kind: "release" }),
      homeFoldersOf({ kind: "development" }),
      homeFoldersOf({ kind: "preview", name: "sync-110" }),
      homeFoldersOf({ kind: "preview", name: "sync-111" }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "data": ".instrument",
          "instrument": "Instrument",
        },
        {
          "data": ".instrument-dev",
          "instrument": "Instrument Dev",
        },
        {
          "data": ".instrument-preview",
          "instrument": "Instrument Preview",
        },
        {
          "data": ".instrument-preview",
          "instrument": "Instrument Preview",
        },
      ]
    `);
    expect(HOME_DATA_FOLDER_NAMES).toMatchInlineSnapshot(`
      [
        ".instrument-dev",
        ".instrument-preview",
        ".instrument",
      ]
    `);
  });
});

describe("previewBuildNameOf", () => {
  it.each([
    ["claude-resume-2", "claude-resume-2-21"],
    ["Claude/Resume 2.21", "claude-resume-2-21-21"],
    [
      "a-very-long-branch-name-that-goes-well-past-forty-characters",
      "a-very-long-branch-name-that-goes-wel-21",
    ],
    ["---", ""],
  ])("names %j's run 21 %j", (name, built) => {
    expect(previewBuildNameOf(name, 21)).toBe(built);
  });

  // The workflow builds under this name, and the build turns it back into
  // its flavor; the two must agree.
  it("is a name the flavor keeps as it is", () => {
    const built = previewBuildNameOf("Claude/Resume 2.21", 21);
    expect(appFlavorOf({ nodeEnv: "production", previewName: built })).toEqual({
      kind: "preview",
      name: built,
    });
  });
});
