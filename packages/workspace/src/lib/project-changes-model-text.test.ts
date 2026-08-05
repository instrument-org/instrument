import { describe, expect, it } from "vitest";

import { projectChangesModelNote } from "./project-changes-model-text";

const base = {
  foldersAdded: [],
  foldersRemoved: [],
  instructionsChanged: false,
  projectId: "prj_01JQZ0X0000000000000000000" as never,
  projectName: "Acme",
};

describe("projectChangesModelNote", () => {
  it("returns null when nothing changed", () => {
    expect(projectChangesModelNote(base)).toBeNull();
  });

  it("states the access each added folder mounted with", () => {
    expect(
      projectChangesModelNote({
        ...base,
        foldersAdded: [
          { access: "read-write", name: "Site", path: "/work/site" },
          { access: "read-only", name: "Brand", path: "/work/brand" },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders were added to the "Acme" project and are now mounted under /mnt/ with the access shown (the attached-folders context lists the exact paths):
      - Site (read and write)
      - Brand (read-only)
      </instrument-system-note>"
    `);
  });

  it("describes removed folders", () => {
    expect(
      projectChangesModelNote({
        ...base,
        foldersRemoved: [{ name: "Brand", path: "/work/brand" }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders were removed from the "Acme" project and are no longer mounted, so do not attempt to read or search them:
      - Brand
      </instrument-system-note>"
    `);
  });

  it("describes updated instructions alongside a folder change", () => {
    expect(
      projectChangesModelNote({
        ...base,
        foldersAdded: [
          { access: "read-write", name: "Site", path: "/work/site" },
        ],
        instructions: "Keep copy concise.",
        instructionsChanged: true,
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The instructions for the "Acme" project were updated. This is the current version; follow it going forward, and disregard the earlier project instructions:

      Keep copy concise.

      These folders were added to the "Acme" project and are now mounted under /mnt/ with the access shown (the attached-folders context lists the exact paths):
      - Site (read and write)
      </instrument-system-note>"
    `);
  });
});
