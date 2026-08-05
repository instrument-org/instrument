import { describe, expect, it } from "vitest";

import { attachedFolderChangesModelNote } from "./attached-folder-changes-model-text";

describe("attachedFolderChangesModelNote", () => {
  it("returns null when nothing changed", () => {
    expect(
      attachedFolderChangesModelNote({
        accessChanged: [],
        removed: [],
        renamed: [],
      }),
    ).toBeNull();
  });

  it("describes removed folders", () => {
    expect(
      attachedFolderChangesModelNote({
        accessChanged: [],
        removed: [{ name: "Downloads", path: "/base/Downloads" }],
        renamed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:
      - Downloads
      </instrument-system-note>"
    `);
  });

  it("describes renamed folders", () => {
    expect(
      attachedFolderChangesModelNote({
        accessChanged: [],
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
      These attached folders were renamed because another attached folder now shares their old name. Use the new name and its /mnt path instead of any old one you referenced earlier:
      - Downloads -> CloudDocs-Downloads
      </instrument-system-note>"
    `);
  });

  it("describes both in one note", () => {
    expect(
      attachedFolderChangesModelNote({
        accessChanged: [],
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
      The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:
      - Old

      These attached folders were renamed because another attached folder now shares their old name. Use the new name and its /mnt path instead of any old one you referenced earlier:
      - Downloads -> Local-Downloads
      </instrument-system-note>"
    `);
  });

  it("describes an access change", () => {
    expect(
      attachedFolderChangesModelNote({
        accessChanged: [
          { access: "read-write", name: "Photos", path: "/base/Photos" },
          { access: "read-only", name: "Docs", path: "/base/Docs" },
        ],
        removed: [],
        renamed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user changed what you may do with these attached folders. This supersedes the access level listed in your attached-folders context, which may be older than this message:
      - Photos: now read and write
      - Docs: now read-only
      </instrument-system-note>"
    `);
  });
});
