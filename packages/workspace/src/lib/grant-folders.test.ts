import { describe, expect, it } from "vitest";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { grantFolders } from "./grant-folders";

const held = FolderAttachment.Schema.parse({
  access: "read-only",
  createdAt: 1,
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  mountName: "Downloads",
  path: "/Users/x/Downloads",
  source: "user",
});

function names(granted: ReturnType<typeof grantFolders>) {
  return Object.fromEntries(
    Object.values(granted.folders).map((folder) => [
      folder.path,
      `${folder.mountName} (${folder.access})`,
    ]),
  );
}

describe("grantFolders", () => {
  it("mounts a folder under the name its grant carries", () => {
    const granted = grantFolders(
      [held],
      [
        {
          access: "read-write",
          mountName: "Home/Desktop",
          path: AbsolutePathSchema.parse("/Users/x/Desktop"),
          source: "user",
        },
      ],
      2,
    );
    expect(names(granted)).toEqual({
      "/Users/x/Desktop": "Home/Desktop (read-write)",
      "/Users/x/Downloads": "Downloads (read-only)",
    });
  });

  it("re-grants a folder it holds under the name it has", () => {
    const granted = grantFolders(
      [held],
      [
        {
          access: "read-write",
          mountName: "Home/Downloads",
          path: held.path,
          source: "user",
        },
      ],
      2,
    );
    expect(names(granted)).toEqual({
      "/Users/x/Downloads": "Downloads (read-write)",
    });
    expect(granted.granted.map((folder) => folder.mountName)).toEqual([
      "Downloads",
    ]);
  });

  it("assigns a name around the ones held where the grant's is taken", () => {
    const granted = grantFolders(
      [held],
      [
        {
          access: "read-write",
          mountName: "Downloads",
          path: AbsolutePathSchema.parse("/Volumes/Archive/Downloads"),
          source: "user",
        },
      ],
      2,
    );
    expect(names(granted)).toEqual({
      "/Users/x/Downloads": "Downloads (read-only)",
      "/Volumes/Archive/Downloads": "Archive-Downloads (read-write)",
    });
  });
});
