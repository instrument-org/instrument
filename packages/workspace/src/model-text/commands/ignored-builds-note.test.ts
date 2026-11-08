import { describe, expect, it } from "vitest";

import { ignoredBuildsNote } from "./ignored-builds-note";

describe("ignoredBuildsNote", () => {
  it("says how to allow and run the skipped builds where they were installed", () => {
    expect(
      ignoredBuildsNote(
        'Ignored build scripts: esbuild@0.24.0.\nRun "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
      ),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      Some packages were not built during installation.
      If you encounter "Cannot find module" errors or the package doesn't work, run \`pnpm approve-builds <package-name>...\` with the package names from the warning, in the folder you installed them in. It allows their install scripts in that folder's pnpm-workspace.yaml and runs them.
      </instrument-system-note>"
    `);
  });

  it("says nothing when no build was skipped", () => {
    expect(ignoredBuildsNote("Done in 273ms")).toBeUndefined();
  });
});
