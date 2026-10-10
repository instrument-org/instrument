import { describe, expect, it } from "vitest";

import {
  moveSidebarPlaces,
  NO_SIDEBAR_CHANGES,
  pinnedPlaces,
  pinPlace,
  restoreDefaultPlaces,
  unpinPlace,
} from "./sidebar-places";

const defaults = [
  { name: "casey", path: "/Users/casey" },
  { name: "Desktop", path: "/Users/casey/Desktop" },
];
const placeOf = (path: string) => ({
  name: path.split("/").at(-1) ?? path,
  path,
});
const rows = (places: typeof NO_SIDEBAR_CHANGES) =>
  pinnedPlaces(defaults, places, placeOf).map((place) => place.name);

describe("sidebar places", () => {
  it("shows the defaults, then what was pinned in the order pinned", () => {
    let places = pinPlace(NO_SIDEBAR_CHANGES, "/Users/casey/Work");
    places = pinPlace(places, "/Volumes/Archive");
    places = pinPlace(places, "/Users/casey/Work");
    expect(rows(places)).toEqual(["casey", "Desktop", "Work", "Archive"]);
  });

  it("hides an unpinned default until it is restored, keeping what was pinned", () => {
    let places = pinPlace(NO_SIDEBAR_CHANGES, "/Users/casey/Work");
    places = unpinPlace(places, "/Users/casey");
    expect(rows(places)).toEqual(["Desktop", "Work"]);
    expect(rows(restoreDefaultPlaces(places))).toEqual([
      "casey",
      "Desktop",
      "Work",
    ]);
  });

  it("puts a default pinned again back in its own place, once", () => {
    let places = unpinPlace(NO_SIDEBAR_CHANGES, "/Users/casey");
    places = pinPlace(places, "/Users/casey");
    expect(rows(places)).toEqual(["casey", "Desktop"]);
  });

  it("takes an unpinned folder of the person's off the list", () => {
    const places = unpinPlace(
      pinPlace(NO_SIDEBAR_CHANGES, "/Users/casey/Work"),
      "/Users/casey/Work",
    );
    expect(rows(places)).toEqual(["casey", "Desktop"]);
  });

  it("follows a renamed folder and the folders inside it, and leaves a sibling sharing its prefix", () => {
    let places = pinPlace(NO_SIDEBAR_CHANGES, "/Users/casey/Work");
    places = pinPlace(places, "/Users/casey/Work/Taxes");
    places = pinPlace(places, "/Users/casey/Workshop");
    expect(
      moveSidebarPlaces(places, "/Users/casey/Work", "/Users/casey/Jobs", "/")
        .pinned,
    ).toEqual([
      "/Users/casey/Jobs",
      "/Users/casey/Jobs/Taxes",
      "/Users/casey/Workshop",
    ]);
  });
});
