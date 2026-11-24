import { describe, expect, it } from "vitest";

import { pageLandingOf, type SideShows, type UnderPoint } from "./accepts";
import { type SideZone } from "./landing";
import { type Held } from "./types";

const LIT = { height: 600, left: 0, top: 0, width: 800 };
const JOIN: SideZone = { kind: "join", lit: LIT, side: 0 };
const EDGE: SideZone = {
  edge: { height: 576, left: 794, top: 12, width: 3 },
  kind: "split",
  lit: LIT,
  side: 1,
};

const FILES: Held = {
  count: 1,
  files: [{ hostPath: "/Users/mac-user/Desktop/Shot.png", isFolder: false }],
  ids: ["f"],
  kind: "files",
};
const LINK: Held = {
  id: "l",
  kind: "link",
  title: "Example",
  url: "https://example.com/",
};
const BOOKMARK: Held = { ...LINK, bookmark: "b" };
const PLACE: Held = {
  id: "p",
  kind: "link",
  place: { path: "/Users/mac-user/Documents" },
  title: "Documents",
  url: "file:///Users/mac-user/Documents/",
};
const PINNED_PLACE: Held = {
  id: "p",
  kind: "link",
  place: {
    path: "/Users/mac-user/Documents",
    favorites: ["/Users/mac-user/Documents"],
  },
  title: "Documents",
  url: "file:///Users/mac-user/Documents/",
};
const TAB: Held = { group: "g", id: "t", key: "t", kind: "tab", side: 0 };

/** What letting go over a side's page does, said in a word. */
const landing = ({
  held,
  input = held.kind === "files" ||
  (held.kind === "link" && !held.bookmark && !held.place)
    ? "native"
    : "pointer",
  shows = "other",
  under,
  zone = JOIN,
}: {
  held: Held;
  input?: "native" | "pointer";
  shows?: SideShows;
  under?: UnderPoint;
  /** Where the side's page says it goes (`sideZoneAt`), or nowhere (`null`). */
  zone?: SideZone | null;
}) => {
  const found = pageLandingOf({
    group: "g",
    held,
    input,
    page: LIT,
    shows,
    tab: "up",
    under,
    zone: zone ?? undefined,
  });
  if (found === "native" || found === undefined) {
    return found ?? "nothing";
  }
  return found.kind === "side" ? (found.split ? "split" : "side") : found.kind;
};

describe("pageLandingOf", () => {
  it.each([
    // A web page takes content itself, through the system's drag.
    { expected: "native", held: FILES, shows: "site" },
    { expected: "native", held: LINK, shows: "site" },
    // So does a composer's box: files attach, a link's words go in.
    { expected: "native", held: FILES, under: "box" },
    { expected: "native", held: LINK, under: "box" },
    { expected: "native", held: FILES, shows: "newTab", under: "box" },
    // A field takes a link, not files.
    { expected: "native", held: LINK, under: "text" },
    { expected: "side", held: FILES, under: "text" },
    // A folder in Files takes files.
    { expected: "native", held: FILES, under: "folder" },
    // Anything standing over the page hears the drag itself.
    { expected: "native", held: FILES, under: "over" },
    // A new tab turns into content let go on its ground.
    { expected: "newTab", held: FILES, shows: "newTab" },
    { expected: "newTab", held: LINK, shows: "newTab" },
    // Elsewhere content opens on the side.
    { expected: "side", held: FILES },
    { expected: "side", held: LINK },
  ] satisfies {
    expected: string;
    held: Held;
    shows?: SideShows;
    under?: UnderPoint;
  }[])(
    "content: $held.kind over $shows / $under is $expected",
    ({ expected, ...over }) => {
      expect(landing(over)).toBe(expected);
    },
  );

  it.each([FILES, LINK, TAB, BOOKMARK])(
    "the group's outer edge wins over what the page takes ($kind)",
    (held) => {
      expect(landing({ held, shows: "site", under: "box", zone: EDGE })).toBe(
        "split",
      );
    },
  );

  it.each([
    { shows: "other", zone: EDGE },
    { shows: "other", zone: JOIN },
    { shows: "site", zone: JOIN },
    { shows: "newTab", zone: JOIN },
  ] satisfies { shows: SideShows; zone: SideZone }[])(
    "lands a place nowhere on a page, its edge included ($shows, $zone.kind)",
    (over) => {
      expect([
        landing({ held: PLACE, ...over }),
        landing({ held: PINNED_PLACE, ...over }),
      ]).toEqual(["nothing", "nothing"]);
    },
  );

  it("leaves a folder in Files its drops everywhere but the edge", () => {
    expect([
      landing({ held: FILES, under: "folder", zone: JOIN }),
      landing({ held: FILES, under: "folder", zone: EDGE }),
    ]).toEqual(["native", "split"]);
  });

  it.each([
    // A tab lands on no page, only at its edge (`sideZoneAt` says none).
    { expected: "nothing", held: TAB, under: "box", zone: null },
    { expected: "nothing", held: TAB, shows: "newTab", zone: null },
    // A bookmark opens as a tab from a strip or an edge, never from a
    // page's content.
    { expected: "nothing", held: BOOKMARK },
    { expected: "nothing", held: BOOKMARK, shows: "site" },
    { expected: "nothing", held: BOOKMARK, under: "text" },
    { expected: "nothing", held: BOOKMARK, under: "box" },
    { expected: "nothing", held: BOOKMARK, shows: "newTab" },
    // A place of Files' sidebar is a link to Files there, never the folder.
    { expected: "nothing", held: PLACE, under: "folder" },
  ] satisfies {
    expected: string;
    held: Held;
    shows?: SideShows;
    under?: UnderPoint;
    zone?: SideZone | null;
  }[])(
    "a piece of the window is never handed to a page: $held.kind over $shows / $under is $expected",
    ({ expected, ...over }) => {
      expect(landing(over)).toBe(expected);
    },
  );
});
