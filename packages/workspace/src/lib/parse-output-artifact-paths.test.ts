import { describe, expect, it } from "vitest";

import { parseOutputArtifactPaths } from "./parse-output-artifact-paths";

describe("parseOutputArtifactPaths", () => {
  it("keeps added and modified output files, sorted, ignoring non-output", () => {
    const output = [
      "M\toutput/zebra.png",
      "A\tsrc/App.tsx",
      "A\toutput/apple.png",
    ].join("\n");
    expect(parseOutputArtifactPaths(output)).toMatchInlineSnapshot(`
      [
        "output/apple.png",
        "output/zebra.png",
      ]
    `);
  });

  it("drops deleted files", () => {
    const output = ["A\toutput/keep.png", "D\toutput/gone.png"].join("\n");
    expect(parseOutputArtifactPaths(output)).toEqual(["output/keep.png"]);
  });

  it("uses the destination path for renames", () => {
    const output = "R100\toutput/old.png\toutput/new.png";
    expect(parseOutputArtifactPaths(output)).toEqual(["output/new.png"]);
  });
});
