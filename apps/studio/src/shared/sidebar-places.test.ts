import { describe, expect, it } from "vitest";

import {
  adoptSystemSidebar,
  firstPinnedFolder,
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

  it("adopts the file manager's pins in its order, hiding the defaults it leaves out", () => {
    const places = adoptSystemSidebar(
      NO_SIDEBAR_CHANGES,
      ["/Users/casey/code", "/Users/casey/Desktop", "/Applications"],
      defaults.map((place) => place.path),
    );
    expect(rows(places)).toEqual(["code", "Desktop", "Applications"]);
  });

  it("keeps what the person pinned when adopting the file manager's pins", () => {
    let places = pinPlace(NO_SIDEBAR_CHANGES, "/Users/casey/Work");
    places = pinPlace(places, "/Users/casey");
    places = adoptSystemSidebar(
      places,
      ["/Users/casey/code"],
      defaults.map((place) => place.path),
    );
    expect(rows(places)).toEqual(["code", "casey", "Work"]);
    expect(rows(pinPlace(places, "/Volumes/Archive")).at(-1)).toBe("Archive");
  });

  it.each([
    {
      name: "the first default, past the Instrument folder above Pinned",
      places: NO_SIDEBAR_CHANGES,
      first: "/Users/casey",
    },
    {
      name: "the next row once the top one is unpinned",
      places: unpinPlace(NO_SIDEBAR_CHANGES, "/Users/casey"),
      first: "/Users/casey/Desktop",
    },
    {
      name: "the top of an adopted order, past Applications",
      places: adoptSystemSidebar(
        NO_SIDEBAR_CHANGES,
        ["/Applications", "/Users/casey/Desktop"],
        defaults.map((place) => place.path),
      ),
      first: "/Users/casey/Desktop",
    },
    {
      name: "the next row past a home folder of apps",
      places: adoptSystemSidebar(
        NO_SIDEBAR_CHANGES,
        ["/Users/casey/Applications", "/Users/casey"],
        defaults.map((place) => place.path),
      ),
      first: "/Users/casey",
    },
    {
      name: "nothing with nothing pinned",
      places: {
        ...NO_SIDEBAR_CHANGES,
        unpinned: defaults.map((place) => place.path),
      },
      first: undefined,
    },
  ])("starts Files at $name", ({ places, first }) => {
    expect(
      firstPinnedFolder(
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
