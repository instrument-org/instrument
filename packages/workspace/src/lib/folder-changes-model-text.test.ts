import { describe, expect, it } from "vitest";

import { folderChangesModelNote } from "./folder-changes-model-text";

describe("folderChangesModelNote", () => {
  it("returns null when nothing changed", () => {
    expect(folderChangesModelNote({ added: [], removed: [] })).toBeNull();
  });

  it("describes folders handed over since the last turn", () => {
    expect(
      folderChangesModelNote({
        added: [
          { access: "read-write", path: "/base/Downloads" },
          { access: "read-only", path: "/base/Photos" },
        ],
        removed: [],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      You have been given these folders since your last activity. They are ready to read now, alongside the ones your folders context lists:
      - "Downloads" at /base/Downloads (read and write)
      - "Photos" at /base/Photos (read-only)
      </instrument-system-note>"
    `);
  });

  it("describes removed folders", () => {
    expect(
      folderChangesModelNote({
        added: [],
        removed: [{ path: "/base/Downloads" }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These folders were taken back from this chat since your last activity, so do not attempt to read or search them:
      - "Downloads" at /base/Downloads
      </instrument-system-note>"
    `);
  });

  it("describes both in one note", () => {
    expect(
      folderChangesModelNote({
        added: [{ access: "read-only", path: "/base/Photos" }],
        removed: [{ path: "/base/Old" }],
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      You have been given these folders since your last activity. They are ready to read now, alongside the ones your folders context lists:
      - "Photos" at /base/Photos (read-only)

      These folders were taken back from this chat since your last activity, so do not attempt to read or search them:
      - "Old" at /base/Old
      </instrument-system-note>"
    `);
  });
});
