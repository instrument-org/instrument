import { describe, expect, it } from "vitest";

import { FolderAttachment } from "./folder-attachment";

const STORED_BEFORE_THE_RENAME = {
  access: "read-write",
  createdAt: 1_718_198_400_000,
  id: "01KZ9NPNZZPQF80Z7A7DG4Z5BN",
  name: "Home-Downloads",
  path: "/Users/sam/Downloads",
  source: "user",
};

describe("FolderAttachment.StoredSchema", () => {
  // Every task attached before the rename has `name` in its state.json and in
  // its stored message parts. Rejecting those would not fail loudly; it would
  // drop the folders out of tasks that still have them mounted.
  it("reads a folder stored under the old field name", () => {
    const folder = FolderAttachment.StoredSchema.parse(
      STORED_BEFORE_THE_RENAME,
    );

    expect(folder.mountName).toBe("Home-Downloads");
    expect(folder.path).toBe("/Users/sam/Downloads");
    expect(folder.access).toBe("read-write");
  });

  it("reads a folder stored under the current field name", () => {
    const { name, ...rest } = STORED_BEFORE_THE_RENAME;
    const folder = FolderAttachment.StoredSchema.parse({
      ...rest,
      mountName: name,
    });

    expect(folder.mountName).toBe("Home-Downloads");
  });

  // The legacy branch renames rather than duplicating, so nothing downstream
  // can read the old field and quietly keep working.
  it("answers with the current shape either way", () => {
    const legacy = FolderAttachment.StoredSchema.parse(
      STORED_BEFORE_THE_RENAME,
    );

    expect(legacy).not.toHaveProperty("name");
    expect(Object.keys(legacy).toSorted()).toEqual([
      "access",
      "createdAt",
      "id",
      "mountName",
      "path",
      "source",
    ]);
  });

  it("still applies the defaults a legacy folder relies on", () => {
    const { access: _access, source: _source, ...withoutDefaults } =
      STORED_BEFORE_THE_RENAME;
    const folder = FolderAttachment.StoredSchema.parse(withoutDefaults);

    expect(folder.access).toBe("read-only");
    expect(folder.source).toBe("user");
    expect(folder.mountName).toBe("Home-Downloads");
  });

  it("rejects a folder carrying neither name", () => {
    const { name: _name, ...withoutAnyName } = STORED_BEFORE_THE_RENAME;

    expect(
      FolderAttachment.StoredSchema.safeParse(withoutAnyName).success,
    ).toBe(false);
  });
});

describe("FolderAttachment.Schema", () => {
  // The tolerance is for the read path only: anything we write, and anything an
  // RPC caller or tool hands us, carries the current field.
  it("does not accept the old field name", () => {
    expect(
      FolderAttachment.Schema.safeParse(STORED_BEFORE_THE_RENAME).success,
    ).toBe(false);
  });
});
