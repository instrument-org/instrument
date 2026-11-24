import { describe, expect, it, vi } from "vitest";

import { type Held } from "./drag/types";
import {
  favoritesLandingAt,
  favoritesOrder,
  type FavoriteRow,
} from "./favorites-drops";

// The drag session reaches the window's RPC client, which node has no window for.
vi.mock("./drag/session", () => ({ dragAtom: {}, useDropTarget: () => {} }));

const HOME = "/Users/mac-user";
const ROWS: FavoriteRow[] = ["Desktop", "Documents", "Downloads"].map(
  (name, index) => ({
    name,
    path: `${HOME}/${name}`,
    rect: { height: 28, left: 8, top: 100 + index * 28, width: 200 },
  }),
);

const place = (name: string): Held => ({
  id: "p",
  kind: "link",
  place: { path: `${HOME}/${name}` },
  title: name,
  url: `file://${HOME}/${name}/`,
});

const files = (...paths: [string, boolean][]): Held => ({
  count: paths.length,
  files: paths.map(([hostPath, isFolder]) => ({ hostPath, isFolder })),
  ids: paths.map(([hostPath]) => hostPath),
  kind: "files",
});

/** What letting go at a height over Favorites does, in a word. */
const at = (held: Held, y: number) => {
  const found = favoritesLandingAt({ held, point: { x: 100, y }, rows: ROWS });
  if (found === undefined || found === "refused") {
    return found ?? "nothing";
  }
  if (found.kind === "favorite") {
    return `${found.moves ? "move" : "add"} at ${String(found.index)}`;
  }
  return found.kind === "into"
    ? `${found.copies ? "copy" : "move"} into ${found.name}`
    : found.kind;
};

describe("favoritesOrder", () => {
  it.each([
    [["Pictures"], 0, "Pictures Desktop Documents Downloads"],
    [["Pictures"], 3, "Desktop Documents Downloads Pictures"],
    [["Downloads"], 1, "Desktop Downloads Documents"],
    [["Desktop"], 3, "Documents Downloads Desktop"],
  ] as const)("puts %o at gap %i: %s", (moving, gap, expected) => {
    expect(
      favoritesOrder(
        ROWS.map((row) => row.name),
        moving,
        gap,
      ).join(" "),
    ).toBe(expected);
  });
});

describe("favoritesLandingAt", () => {
  it.each([
    // A place stands at the line nearest the pointer, adding it there.
    [
      "a place not in Favorites, above the first row",
      place("Pictures"),
      96,
      "add at 0",
    ],
    [
      "a place not in Favorites, on the second row",
      place("Pictures"),
      120,
      "add at 1",
    ],
    [
      "a place not in Favorites, below the last row",
      place("Pictures"),
      190,
      "add at 3",
    ],
    // A Favorites row moves along the same line.
    ["a Favorites row, past the next", place("Desktop"), 160, "move at 2"],
    // Where its row already stands, letting go does nothing.
    ["a Favorites row, at its own line", place("Desktop"), 104, "refused"],
    ["a Favorites row, just below itself", place("Desktop"), 120, "refused"],
    // A folder is added at a line near a row's top or bottom.
    [
      "a folder at a row's top",
      files([`${HOME}/Pictures`, true]),
      130,
      "add at 1",
    ],
    [
      "a folder below the rows",
      files([`${HOME}/Pictures`, true]),
      186,
      "add at 3",
    ],
    // In a row's middle, files and folders go into its folder.
    [
      "a folder in a row's middle",
      files([`${HOME}/Pictures`, true]),
      142,
      "copy into Documents",
    ],
    [
      "a file in a row's middle",
      files([`${HOME}/Desktop/a.png`, false]),
      170,
      "copy into Downloads",
    ],
    // Files that are there already, or the folder itself, go nowhere.
    [
      "a file already in that folder",
      files([`${HOME}/Downloads/a.png`, false]),
      170,
      "refused",
    ],
    [
      "the row's own folder",
      files([`${HOME}/Downloads`, true]),
      170,
      "refused",
    ],
    ["a folder that holds the row's", files([HOME, true]), 170, "refused"],
    // A file off the rows lands nowhere in Favorites.
    [
      "a file below the rows",
      files([`${HOME}/Desktop/a.png`, false]),
      186,
      "refused",
    ],
    // A drag whose files are not known yet changes nothing.
    [
      "files not known yet",
      { count: 1, files: undefined, ids: ["x"], kind: "files" },
      142,
      "refused",
    ],
    // Anything else held is the page's to answer for.
    [
      "a tab",
      { group: "g", id: "t", key: "t", kind: "tab", side: 0 },
      142,
      "nothing",
    ],
  ] satisfies [string, Held, number, string][])(
    "%s: %s",
    (_, held, y, expected) => {
      expect(at(held, y)).toBe(expected);
    },
  );

  it("draws the line between two rows, inset from their sides", () => {
    const found = favoritesLandingAt({
      held: place("Pictures"),
      point: { x: 100, y: 124 },
      rows: ROWS,
    });
    expect(
      found !== "refused" && found?.kind === "favorite" && found.line,
    ).toEqual({
      height: 2,
      left: 14,
      top: 127,
      width: 188,
    });
  });
});
