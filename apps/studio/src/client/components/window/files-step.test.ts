import { describe, expect, it } from "vitest";

import {
  arrivalView,
  type FilesIntent,
  type FilesStep,
  nextStep,
  settleArrival,
} from "./files-step";

const DOCS: FilesStep = {
  path: "Documents/",
  query: "report",
  root: "~",
  select: "Documents/report.pdf",
  view: "icons",
};
const BESIDE: FilesStep = {
  file: "/Users/sam/Documents/report.pdf",
  path: "Documents/",
  root: "~",
  tree: "/Users/sam/Documents",
  view: "table",
};

/** A step as one line: the keys it has, in order. */
function line(step: FilesStep) {
  return Object.entries(step)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

const EVENTS: [string, FilesStep, FilesIntent][] = [
  [
    "a place",
    DOCS,
    { root: "/Users/sam/Downloads", type: "arrive", view: "columns" },
  ],
  [
    "a place with a folder under it",
    DOCS,
    { path: "Music/", root: "~", type: "arrive", view: "table" },
  ],
  ["double-click a folder", DOCS, { path: "Documents/Old/", type: "walk" }],
  [
    "a folder selected in the columns, searched",
    DOCS,
    { path: "Documents/Old/", query: "report", type: "walk" },
  ],
  [
    "up past the root",
    BESIDE,
    { path: "", root: "/Users/sam", select: "Documents/", type: "walk" },
  ],
  ["select", DOCS, { path: "Documents/notes.md", type: "select" }],
  ["select nothing", DOCS, { path: null, type: "select" }],
  [
    "select what is selected",
    DOCS,
    { path: DOCS.select ?? null, type: "select" },
  ],
  ["search", DOCS, { query: "notes", type: "search" }],
  ["clear the search", DOCS, { query: "", type: "search" }],
  ["change the layout", DOCS, { type: "setLayout", view: "columns" }],
  ["the same layout", DOCS, { type: "setLayout", view: "icons" }],
  [
    "open a file",
    DOCS,
    {
      file: "/Users/sam/Documents/report.pdf",
      tree: "/Users/sam/Documents",
      type: "openFile",
    },
  ],
  [
    "a link to a file",
    BESIDE,
    { file: "/Users/sam/Documents/notes.md", type: "openFile" },
  ],
  [
    "another file picked beside the folder",
    BESIDE,
    { file: "/Users/sam/Documents/notes.md", type: "followFile" },
  ],
  ["close the file", BESIDE, { type: "closeFile" }],
];

describe("the step a change leads to", () => {
  it("writes each change as a step, in place, or not at all", () => {
    expect(
      EVENTS.map(([name, step, intent]) => {
        const next = nextStep(step, intent);
        return `${name}: ${next.write} ${line(next.step)}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "a place: push path= root=/Users/sam/Downloads view=columns",
        "a place with a folder under it: push path=Music/ root=~ view=table",
        "double-click a folder: push path=Documents/Old/ root=~ view=icons",
        "a folder selected in the columns, searched: push path=Documents/Old/ query=report root=~ view=icons",
        "up past the root: push file=/Users/sam/Documents/report.pdf path= root=/Users/sam select=Documents/ tree=/Users/sam/Documents view=table",
        "select: replace path=Documents/ query=report root=~ select=Documents/notes.md view=icons",
        "select nothing: replace path=Documents/ query=report root=~ view=icons",
        "select what is selected: none path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
        "search: replace path=Documents/ query=notes root=~ select=Documents/report.pdf view=icons",
        "clear the search: replace path=Documents/ root=~ select=Documents/report.pdf view=icons",
        "change the layout: replace path=Documents/ query=report root=~ select=Documents/report.pdf view=columns",
        "the same layout: none path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
        "open a file: push file=/Users/sam/Documents/report.pdf path=Documents/ query=report root=~ tree=/Users/sam/Documents view=icons",
        "a link to a file: push file=/Users/sam/Documents/notes.md path=Documents/ root=~ tree=/Users/sam/Documents view=table",
        "another file picked beside the folder: replace file=/Users/sam/Documents/notes.md path=Documents/ root=~ tree=/Users/sam/Documents view=table",
        "close the file: push path=Documents/ root=~ view=table",
      ]
    `);
  });

  it.each(
    EVENTS.filter(
      ([, , intent]) => intent.type !== "arrive" && intent.type !== "setLayout",
    ),
  )("keeps the layout the step was in: %s", (_name, step, intent) => {
    expect(nextStep(step, intent).step.view).toBe(step.view);
  });

  it.each(EVENTS.filter(([, , intent]) => intent.type === "walk"))(
    "keeps the layout and the file on a walk: %s",
    (_name, step, intent) => {
      const { file, tree, view } = nextStep(step, intent).step;
      expect({ file, tree, view }).toEqual({
        file: step.file,
        tree: step.tree,
        view: step.view,
      });
    },
  );
});

describe("an address arriving from outside the tab", () => {
  // The folder's own layout, by root and path; none set for any other.
  const viewOf = (root: string, path: string) =>
    arrivalView(
      root === "~" && path === "Music/" ? "list" : undefined,
      "table",
    );

  it("settles each into a step once, and a step as it is", () => {
    const arrivals: [string, FilesStep][] = [
      ["a place", { path: "", root: "/Users/sam/Downloads" }],
      ["a folder with a layout of its own", { path: "Music/", root: "~" }],
      [
        "a file opened into a tab of its own",
        {
          file: "/Users/sam/Music/song.mp3",
          path: "",
          root: "~",
          tree: "/Users/sam/Music",
        },
      ],
      [
        "a file with no tree",
        { file: "/Users/sam/notes.md", path: "", root: "~" },
      ],
      ["a step", DOCS],
    ];
    expect(
      arrivals.map(
        ([name, step]) => `${name}: ${line(settleArrival(step, viewOf))}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "a place: path= root=/Users/sam/Downloads view=table",
        "a folder with a layout of its own: path=Music/ root=~ view=list",
        "a file opened into a tab of its own: file=/Users/sam/Music/song.mp3 path= root=/Users/sam/Music tree=/Users/sam/Music view=table",
        "a file with no tree: file=/Users/sam/notes.md path= root=~ view=table",
        "a step: path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
      ]
    `);
  });

  it.each([
    [undefined, "list", "columns"],
    [undefined, "icons", "icons"],
    ["list", "icons", "list"],
  ] as const)(
    "opens a folder whose own layout is %s, the last chosen %s, in %s",
    (own, lastChosen, expected) => {
      expect(arrivalView(own, lastChosen)).toBe(expected);
    },
  );
});
