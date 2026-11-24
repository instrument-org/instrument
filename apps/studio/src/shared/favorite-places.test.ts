import { describe, expect, it } from "vitest";

import {
  adoptSystemSidebar,
  firstFavoriteFolder,
  moveFavorites,
  NO_FAVORITE_CHANGES,
  favoritePlaces,
  addFavorite,
  removeFavorite,
  withFavoriteChanges,
} from "./favorite-places";

const defaults = [
  { name: "casey", path: "/Users/casey" },
  { name: "Desktop", path: "/Users/casey/Desktop" },
];
const placeOf = (path: string) => ({
  name: path.split("/").at(-1) ?? path,
  path,
});
const rows = (places: typeof NO_FAVORITE_CHANGES) =>
  favoritePlaces(defaults, places, placeOf).map((place) => place.name);

describe("sidebar places", () => {
  it("shows the defaults, then what was added in the order added", () => {
    let places = addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work");
    places = addFavorite(places, "/Volumes/Archive");
    places = addFavorite(places, "/Users/casey/Work");
    expect(rows(places)).toEqual(["casey", "Desktop", "Work", "Archive"]);
  });

  it("adds a folder at the place among the rows it was let go", () => {
    const places = addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work", [
      "/Users/casey",
      "/Users/casey/Work",
      "/Users/casey/Desktop",
    ]);
    expect(rows(places)).toEqual(["casey", "Work", "Desktop"]);
  });

  it("hides an removed default, keeping what was added", () => {
    let places = addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work");
    places = removeFavorite(places, "/Users/casey");
    expect(rows(places)).toEqual(["Desktop", "Work"]);
  });

  it("puts a default added again back in its own place, once", () => {
    let places = removeFavorite(NO_FAVORITE_CHANGES, "/Users/casey");
    places = addFavorite(places, "/Users/casey");
    expect(rows(places)).toEqual(["casey", "Desktop"]);
  });

  it("takes an removed folder of the person's off the list", () => {
    const places = removeFavorite(
      addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work"),
      "/Users/casey/Work",
    );
    expect(rows(places)).toEqual(["casey", "Desktop"]);
  });

  it("follows a renamed folder and the folders inside it, and leaves a sibling sharing its prefix", () => {
    let places = addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work");
    places = addFavorite(places, "/Users/casey/Work/Taxes");
    places = addFavorite(places, "/Users/casey/Workshop");
    expect(
      moveFavorites(places, "/Users/casey/Work", "/Users/casey/Jobs", "/")
        .added,
    ).toEqual([
      "/Users/casey/Jobs",
      "/Users/casey/Jobs/Taxes",
      "/Users/casey/Workshop",
    ]);
  });

  it("adopts the file manager's pins in its order, hiding the defaults it leaves out", () => {
    const places = adoptSystemSidebar(
      NO_FAVORITE_CHANGES,
      ["/Users/casey/code", "/Users/casey/Desktop", "/Applications"],
      defaults.map((place) => place.path),
    );
    expect(rows(places)).toEqual(["code", "Desktop", "Applications"]);
  });

  it("keeps what the person added when adopting the file manager's pins", () => {
    let places = addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Work");
    places = addFavorite(places, "/Users/casey");
    places = adoptSystemSidebar(
      places,
      ["/Users/casey/code"],
      defaults.map((place) => place.path),
    );
    expect(rows(places)).toEqual(["code", "casey", "Work"]);
    expect(rows(addFavorite(places, "/Volumes/Archive")).at(-1)).toBe(
      "Archive",
    );
  });

  it.each([
    {
      name: "the first default, past the Instrument folder above Favorites",
      places: NO_FAVORITE_CHANGES,
      first: "/Users/casey",
    },
    {
      name: "a row moved to the top",
      places: addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Desktop", [
        "/Users/casey/Desktop",
        "/Users/casey",
      ]),
      first: "/Users/casey/Desktop",
    },
    {
      name: "the next row once the top one is removed",
      places: removeFavorite(NO_FAVORITE_CHANGES, "/Users/casey"),
      first: "/Users/casey/Desktop",
    },
    {
      name: "the top of an adopted order, past Applications",
      places: adoptSystemSidebar(
        NO_FAVORITE_CHANGES,
        ["/Applications", "/Users/casey/Desktop"],
        defaults.map((place) => place.path),
      ),
      first: "/Users/casey/Desktop",
    },
    {
      name: "the next row past a home folder of apps",
      places: addFavorite(NO_FAVORITE_CHANGES, "/Users/casey/Applications", [
        "/Users/casey/Applications",
        "/Users/casey",
      ]),
      first: "/Users/casey",
    },
    {
      name: "nothing with nothing added",
      places: {
        ...NO_FAVORITE_CHANGES,
        removed: defaults.map((place) => place.path),
      },
      first: undefined,
    },
  ])("starts Files at $name", ({ places, first }) => {
    expect(
      firstFavoriteFolder(
        [
          { kind: "output", path: "/Users/casey/Instrument/Files" },
          { kind: "home", path: "/Users/casey" },
          { kind: "folder", path: "/Users/casey/Desktop" },
        ],
        places,
      ),
    ).toBe(first);
  });
});

describe("preferences an earlier build stored", () => {
  it("reads the Pinned section's changes as Favorites', and leaves the rest", () => {
    expect(
      withFavoriteChanges({
        releaseChannel: "beta",
        sidebarPlaces: {
          order: ["/Users/casey/Work"],
          pinned: ["/Users/casey/Work"],
          unpinned: ["/Users/casey"],
        },
      }),
    ).toEqual({
      favoriteChanges: {
        added: ["/Users/casey/Work"],
        order: ["/Users/casey/Work"],
        removed: ["/Users/casey"],
      },
      releaseChannel: "beta",
    });
  });

  it.each([
    { name: "this build's own", stored: { favoriteChanges: { added: [] } } },
    { name: "a file that is not JSON", stored: undefined },
  ])("answers $name as found", ({ stored }) => {
    expect(withFavoriteChanges(stored)).toEqual(stored);
  });
});
