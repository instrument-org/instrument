import { describe, expect, it } from "vitest";

import {
  arrivalView,
  type FilesIntent,
  type FilesStep,
  nextStep,
  routedStep,
  sentStep,
  type SettledStep,
  settleArrival,
  shownStepOf,
} from "./files-step";

const DOCS: SettledStep = {
  path: "Documents/",
  query: "report",
  root: "~",
  select: "Documents/report.pdf",
  view: "icons",
};
const COLUMNS: SettledStep = {
  path: "Documents/",
  query: "report",
  root: "~",
  view: "columns",
};
const BESIDE: SettledStep = {
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

const EVENTS: [string, SettledStep, FilesIntent][] = [
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
    "a folder selected in the columns",
    COLUMNS,
    { path: "Documents/Old/", type: "select" },
  ],
  [
    "a file selected in the column above",
    COLUMNS,
    { path: "notes.md", type: "select" },
  ],
  [
    "several selected in the columns, a folder among them",
    COLUMNS,
    { path: "Documents/Old/", several: true, type: "select" },
  ],
  [
    "a file selected in the column on screen",
    COLUMNS,
    { path: "Documents/report.pdf", type: "select" },
  ],
  [
    "up a folder in the columns",
    COLUMNS,
    { path: "", select: "Documents/", type: "walk" },
  ],
  [
    "the columns left from the folder they stood in",
    { ...COLUMNS, select: "Documents/" },
    { type: "setLayout", view: "icons" },
  ],
  [
    "the columns left from a file",
    { ...COLUMNS, select: "Documents/report.pdf" },
    { type: "setLayout", view: "icons" },
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
  [
    "the columns entered with a folder selected",
    { ...DOCS, select: "Documents/Old/" },
    { type: "setLayout", view: "columns" },
  ],
  ["the same layout", DOCS, { type: "setLayout", view: "icons" }],
  [
    "open a file",
    DOCS,
    {
      file: "/Users/sam/Documents/report.pdf",
      select: "Documents/report.pdf",
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
    {
      file: "/Users/sam/Documents/notes.md",
      select: "Documents/notes.md",
      type: "followFile",
    },
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
        "a folder selected in the columns: push path=Documents/Old/ query=report root=~ select=Documents/Old/ view=columns",
        "a file selected in the column above: push path= query=report root=~ select=notes.md view=columns",
        "several selected in the columns, a folder among them: replace path=Documents/ query=report root=~ select=Documents/Old/ view=columns",
        "a file selected in the column on screen: replace path=Documents/ query=report root=~ select=Documents/report.pdf view=columns",
        "up a folder in the columns: push path=Documents/ root=~ select=Documents/ view=columns",
        "the columns left from the folder they stood in: replace path=Documents/ root=~ view=icons",
        "the columns left from a file: replace path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
        "up past the root: push file=/Users/sam/Documents/report.pdf path= root=/Users/sam select=Documents/ tree=/Users/sam/Documents view=table",
        "select: replace path=Documents/ query=report root=~ select=Documents/notes.md view=icons",
        "select nothing: replace path=Documents/ query=report root=~ view=icons",
        "select what is selected: none path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
        "search: replace path=Documents/ query=notes root=~ select=Documents/report.pdf view=icons",
        "clear the search: replace path=Documents/ root=~ select=Documents/report.pdf view=icons",
        "change the layout: replace path=Documents/ query=report root=~ select=Documents/report.pdf view=columns",
        "the columns entered with a folder selected: replace path=Documents/Old/ query=report root=~ select=Documents/Old/ view=columns",
        "the same layout: none path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
        "open a file: push file=/Users/sam/Documents/report.pdf path=Documents/ query=report root=~ select=Documents/report.pdf tree=/Users/sam/Documents view=icons",
        "a link to a file: push file=/Users/sam/Documents/notes.md path=Documents/ root=~ tree=/Users/sam/Documents view=table",
        "another file picked beside the folder: replace file=/Users/sam/Documents/notes.md path=Documents/ root=~ select=Documents/notes.md tree=/Users/sam/Documents view=table",
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
        "a file opened into a tab of its own: file=/Users/sam/Music/song.mp3 path= root=/Users/sam/Music select=song.mp3 tree=/Users/sam/Music view=table",
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

describe("what the tab shows against its address", () => {
  const sent = (step: SettledStep, intent: FilesIntent) =>
    nextStep(step, intent).step;

  it("shows what it wrote until the address says it, and follows the address moving on its own", () => {
    const walked = sent(DOCS, { path: "Documents/Old/", type: "walk" });
    const selected = sent(walked, {
      path: "Documents/Old/a.md",
      type: "select",
    });
    let shown = sentStep(sentStep(shownStepOf(DOCS), walked), selected);
    const trail = [];
    // The walk read back, a render behind the selection: no arrival.
    shown = routedStep(shown, walked);
    trail.push([
      "the walk read back",
      line(shown.step),
      shown.sent.length,
      shown.arrivals,
    ]);
    shown = routedStep(shown, selected);
    trail.push([
      "the selection read back",
      line(shown.step),
      shown.sent.length,
      shown.arrivals,
    ]);
    // Back, to the step before the walk.
    shown = routedStep(shown, DOCS);
    trail.push(["back", line(shown.step), shown.sent.length, shown.arrivals]);
    expect(trail).toMatchInlineSnapshot(`
      [
        [
          "the walk read back",
          "path=Documents/Old/ root=~ select=Documents/Old/a.md view=icons",
          1,
          0,
        ],
        [
          "the selection read back",
          "path=Documents/Old/ root=~ select=Documents/Old/a.md view=icons",
          0,
          0,
        ],
        [
          "back",
          "path=Documents/ query=report root=~ select=Documents/report.pdf view=icons",
          0,
          1,
        ],
      ]
    `);
  });
});
