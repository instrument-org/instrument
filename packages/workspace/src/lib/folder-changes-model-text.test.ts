import { describe, expect, it } from "vitest";

import { folderChangesModelNote } from "./folder-changes-model-text";

describe("folderChangesModelNote", () => {
  it("returns null when nothing changed", () => {
    expect(
      folderChangesModelNote({
        added: [],
        removed: [],
        renamed: [],
      }),
    ).toBeNull();
  });

  it("describes folders handed over since the last turn", () => {
    expect(
      folderChangesModelNote({
        added: [
          { access: "read-write", name: "Downloads", path: "/base/Downloads" },
          { access: "read-only", name: "Photos", path: "/base/Photos" },
        ],
        removed: [],
        renamed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      You have been given these folders since your last activity. They are mounted and ready to read now, alongside the ones your folders context lists:
      - "Downloads" -> \`/mnt/Downloads\` (read and write)
      - "Photos" -> \`/mnt/Photos\` (read-only)
      </instrument-system-note>"
    `);
  });

  it("describes removed folders", () => {
    expect(
      folderChangesModelNote({
        added: [],
        removed: [{ name: "Downloads", path: "/base/Downloads" }],
        renamed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders were taken back from this chat since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:
      - "Downloads" (was mounted at \`/mnt/Downloads\`)
      </instrument-system-note>"
    `);
  });

  it("describes renamed folders", () => {
    expect(
      folderChangesModelNote({
        added: [],
        removed: [],
        renamed: [
          {
            newName: "CloudDocs-Downloads",
            oldName: "Downloads",
            path: "/base/CloudDocs/Downloads",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders are mounted at a new path. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:
      - "Downloads": now \`/mnt/CloudDocs-Downloads\`, was \`/mnt/Downloads\`
      </instrument-system-note>"
    `);
  });

  it("describes both in one note", () => {
    expect(
      folderChangesModelNote({
        added: [],
        removed: [{ name: "Old", path: "/base/Old" }],
        renamed: [
          {
            newName: "Local-Downloads",
            oldName: "Downloads",
            path: "/base/Downloads",
          },
        ],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders were taken back from this chat since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:
      - "Old" (was mounted at \`/mnt/Old\`)

      These folders are mounted at a new path. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:
      - "Downloads": now \`/mnt/Local-Downloads\`, was \`/mnt/Downloads\`
      </instrument-system-note>"
    `);
  });
});
