import { describe, expect, it } from "vitest";

import { pageLandingOf, type SideShows, type UnderPoint } from "./accepts";
import { type SideZone } from "./landing";
import { type Held } from "./types";

const LIT = { height: 600, left: 0, top: 0, width: 800 };
const JOIN: SideZone = { kind: "join", lit: LIT, side: 0 };
const SPLIT: SideZone = { kind: "split", lit: LIT, side: 1 };

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
const TAB: Held = { group: "g", id: "t", key: "t", kind: "tab", side: 0 };

/** What letting go over a side's page does, said in a word. */
const landing = ({
  held,
  input = held.kind === "files" || (held.kind === "link" && !held.bookmark)
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
  zone?: SideZone;
}) => {
  const found = pageLandingOf({
    group: "g",
    held,
    input,
    page: LIT,
    shows,
    tab: "up",
    under,
    zone,
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
    // A folder in Files takes files, never a place of its sidebar.
    { expected: "native", held: FILES, under: "folder" },
    { expected: "side", held: FILES, under: "place" },
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
    "a split target over the page's end wins over what the page takes ($kind)",
    (held) => {
      expect(landing({ held, shows: "site", under: "box", zone: SPLIT })).toBe(
        "split",
      );
    },
  );

  it.each([
    { expected: "side", held: TAB, under: "box" },
    { expected: "side", held: BOOKMARK, shows: "site" },
    { expected: "side", held: BOOKMARK, under: "text" },
    { expected: "newTab", held: BOOKMARK, shows: "newTab" },
    { expected: "side", held: TAB, shows: "newTab" },
  ] satisfies {
    expected: string;
    held: Held;
    shows?: SideShows;
    under?: UnderPoint;
  }[])(
    "a piece of the window is never handed to a page: $held.kind over $shows / $under is $expected",
    ({ expected, ...over }) => {
      expect(landing(over)).toBe(expected);
    },
  );
});
