import { ORPCError } from "@orpc/client";
import type { ExternalToast } from "sonner";
import { expect, it, vi } from "vitest";

const shown: { title: unknown; data: ExternalToast | undefined }[] = [];
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: Object.assign(vi.fn(), {
    error: (title: unknown, data?: ExternalToast) => {
      shown.push({ data, title });
      return 1;
    },
  }),
}));

const { setToastDeveloperMode } = await import("@/client/lib/toast");
const {
  fileActionFailed,
  filesToPaste,
  placedMessage,
  rootParentSearch,
  rowPress,
  undoFailed,
} = await import("./computer-page");
const { listingCommandOf } = await import("../extend/file-system-keys");

// With Quick Look up, the arrows are handed to the listing's selected row.
it.each([
  { held: "metaKey", os: "mac" },
  { held: "altKey", os: "windows" },
  { held: "altKey", os: "linux" },
] as const)(
  "keeps $held on ↑ handed on from Quick Look, so it goes up a folder on $os",
  ({ held, os }) => {
    const press = new KeyboardEvent("keydown", {
      [held]: true,
      key: "ArrowUp",
    });
    expect(listingCommandOf(rowPress(press), os)).toEqual({ type: "parent" });
  },
);

// Up from the top of the tab's tree is a step of the tab's own, as walking
// into a folder is, so the folder above opens in the layout on screen rather
// than in its own or the last one chosen anywhere.
it.each(["/Users/sam/Documents", "C:\\Users\\sam\\Documents"])(
  "keeps the tab's layout going up from its root at %s",
  (root) => {
    expect(rootParentSearch(root, "list")).toMatchObject({
      select: "Documents/",
      view: "list",
    });
  },
);

it.each(["/", "C:\\", "\\\\server\\share"])(
  "goes up from the top of the disk at %s to the computer",
  (root) => {
    expect(rootParentSearch(root, "list")).toEqual({
      path: "",
      root: "computer:",
      view: "list",
    });
  },
);

it("goes up from a disk mounted in a folder to the computer", () => {
  expect(
    rootParentSearch("/Volumes/Backup", "list", { isDisk: true }),
  ).toMatchObject({ root: "computer:" });
});

// Without Full Disk Access the app cannot find what it moved to the Trash, so
// the move is journaled with nowhere to put it back from, and ⌘Z refuses it.
it("says why ⌘Z cannot put something back, outside developer mode", () => {
  setToastDeveloperMode(false);
  fileActionFailed(
    "Couldn't undo that",
    new ORPCError("CANNOT_UNDO", {
      message:
        "Instrument couldn't find “notes.txt” in the Trash. You can put it back from there in Finder.",
    }),
  );
  expect(shown).toEqual([
    {
      data: expect.objectContaining({
        description:
          "Instrument couldn't find “notes.txt” in the Trash. You can put it back from there in Finder.",
      }),
      title: "Couldn't undo that",
    },
  ]);
});

// The system's file manager does nothing on ⌘Z with nothing to take back.
it("says nothing when ⌘Z has nothing to undo, and why when an undo fails", () => {
  shown.length = 0;
  undoFailed(
    new ORPCError("NOTHING_TO_UNDO", { message: "There is nothing to undo" }),
  );
  expect(shown).toEqual([]);
  undoFailed(new ORPCError("CANNOT_UNDO", { message: "It is gone." }));
  expect(shown.map((each) => each.title)).toEqual(["Couldn't undo that"]);
});

// The Finder's Copy leaves each file on an item of its own, which the page's
// paste event reads only the first of, so the computer's list wins; text on
// the clipboard is never anything a paste here copies.
it("pastes the computer's list of files over the paste's own, and nothing for text alone", () => {
  const event = [{ hostPath: "/a.txt", isFolder: false }];
  const computer = [
    { isFolder: false, path: "/a.txt" },
    { isFolder: true, path: "/pics" },
  ];
  expect(filesToPaste(computer, event)).toEqual([
    { hostPath: "/a.txt", isFolder: false },
    { hostPath: "/pics", isFolder: true },
  ]);
  expect(filesToPaste([], event)).toEqual(event);
  expect(filesToPaste([], [])).toEqual([]);
});

// What the toast says a drop or paste did; skipped ones only when nothing
// else was done.
it.each([
  [[{ how: "moved", path: "/r/a.txt", replaced: false }], 0],
  [[{ how: "moved", path: "/r/a.txt", replaced: true }], 0],
  [
    [
      { how: "moved", path: "/r/a.txt", replaced: true },
      { how: "copied", path: "/r/b", replaced: false },
      { how: "moved", path: "/r/c", replaced: true },
    ],
    1,
  ],
  [[{ how: "copied", path: "/r/a.txt", replaced: false }], 2],
  [[], 2],
  [[], 1],
] as const)("words what a drop did: %j, %i skipped", (placed, skipped) => {
  expect(
    placedMessage({ folderName: "Reports", placed, skipped }),
  ).toMatchSnapshot();
});
