import { describe, expect, it } from "vitest";

import { matchProjectFolders } from "./project-records";

/** Records by id, each naming only its folder. */
function records(entries: Record<string, string>) {
  return new Map(
    Object.entries(entries).map(([id, folder]) => [id, { folder }]),
  );
}

function match(
  folders: string[],
  byId: Record<string, string>,
  fileIds: Record<string, string> = {},
) {
  const found = matchProjectFolders({
    fileIds: new Map(Object.entries(fileIds)),
    folders,
    records: records(byId),
  });
  return {
    byFolder: Object.fromEntries(found.byFolder),
    renamed: found.renamed,
  };
}

describe("matchProjectFolders", () => {
  it("finds each folder's record by its name", () => {
    expect(match(["Garden", "Trips"], { p1: "Trips", p2: "Garden" }))
      .toMatchInlineSnapshot(`
        {
          "byFolder": {
            "Garden": "p2",
            "Trips": "p1",
          },
          "renamed": [],
        }
      `);
  });

  it("takes one folder gone and one folder new as a rename", () => {
    expect(match(["Garden", "Travel"], { p1: "Trips", p2: "Garden" }))
      .toMatchInlineSnapshot(`
        {
          "byFolder": {
            "Garden": "p2",
            "Travel": "p1",
          },
          "renamed": [
            {
              "folder": "Travel",
              "id": "p1",
            },
          ],
        }
      `);
  });

  it.each([
    ["two folders new", ["Travel", "Away"], { p1: "Trips" }],
    ["two records gone", ["Travel"], { p1: "Trips", p2: "Home" }],
  ])("guesses no rename with %s", (_case, folders, byId) => {
    expect(match(folders, byId)).toEqual({ byFolder: {}, renamed: [] });
  });

  it("takes a rename that only changed case even beside other new folders", () => {
    expect(match(["trips", "Away"], { p1: "Trips" })).toEqual({
      byFolder: { trips: "p1" },
      renamed: [{ folder: "trips", id: "p1" }],
    });
  });

  it("follows the id an earlier build wrote into a moved folder's file", () => {
    expect(
      match(["Travel", "Away"], { p1: "Trips", p2: "Home" }, { Away: "p2" }),
    ).toEqual({
      // Which leaves one folder new and one record gone, a rename too.
      byFolder: { Away: "p2", Travel: "p1" },
      renamed: [
        { folder: "Away", id: "p2" },
        { folder: "Travel", id: "p1" },
      ],
    });
  });

  it("takes a file's id with no record as the folder's, for the launch to write down", () => {
    expect(match(["Trips"], {}, { Trips: "p9" })).toEqual({
      byFolder: { Trips: "p9" },
      renamed: [],
    });
  });

  it("gives a copied file's id to no second folder", () => {
    expect(
      match(["Trips", "Trips copy"], { p1: "Trips" }, { "Trips copy": "p1" }),
    ).toEqual({ byFolder: { Trips: "p1" }, renamed: [] });
  });

  it("gives a folder two records name to the smaller id, and counts neither as gone", () => {
    expect(match(["Trips", "Travel"], { p2: "Trips", p1: "Trips" })).toEqual({
      byFolder: { Trips: "p1" },
      renamed: [],
    });
  });
});
