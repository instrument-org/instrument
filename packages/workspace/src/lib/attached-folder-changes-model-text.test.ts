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
      - "Downloads" (was mounted at \`/mnt/Downloads\`)
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
      These folders are mounted at a new path, because another attachment now shares the name theirs was derived from. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:
      - "Downloads": now \`/mnt/CloudDocs-Downloads\`, was \`/mnt/Downloads\`
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
      - "Old" (was mounted at \`/mnt/Old\`)

      These folders are mounted at a new path, because another attachment now shares the name theirs was derived from. Use the new path instead of any old one you referenced earlier. The user's folders were not renamed and are still called what they were called, so do not report a rename:
      - "Downloads": now \`/mnt/Local-Downloads\`, was \`/mnt/Downloads\`
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
      - "Photos" (\`/mnt/Photos\`): now read and write
      - "Docs" (\`/mnt/Docs\`): now read-only
      </instrument-system-note>"
    `);
  });

  // A part persisted before writable folders shipped has no accessChanged at
  // all. Reading a task written back then went through here and threw, taking
  // the transcript down with it.
  it("reads a payload written before a field it expects existed", () => {
    expect(
      attachedFolderChangesModelNote({
        removed: [{ name: "Photos", path: "/base/Photos" }],
        renamed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      The user removed these attached folders from this task since your last activity. Their /mnt mounts are gone, so do not attempt to read or search them:
      - "Photos" (was mounted at \`/mnt/Photos\`)
      </instrument-system-note>"
    `);
  });

  it("has nothing to say about a payload with no lists at all", () => {
    expect(attachedFolderChangesModelNote({})).toBeNull();
  });
});
