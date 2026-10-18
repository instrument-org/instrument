import { DRAFTS_KEY } from "@/shared/kept-state";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createDraftsFolder, draftDirOf } from "./drafts-folder";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "kept-drafts-"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

/** Every file under the workspace, by its path there. */
function tree(): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)),
    )
    .toSorted();
}

/**
 * The one day the tests' drafts were started on, which names their folders.
 * Midday UTC, so the day is the same wherever the machine running the tests
 * is: the folder is named in the writing computer's own zone.
 */
const DAY = Date.parse("2026-10-14T12:00:00.000Z");

const draft = (id: string, words: string, extra: object = {}) => ({
  createdAt: DAY,
  id,
  updatedAt: DAY,
  words,
  ...extra,
});

/** Where the draft with this id is, as a path under the workspace. */
function folderOf(id: string): string {
  return path.relative(root, draftDirOf(root, id));
}

it("writes a draft to a folder named for the day it was started", () => {
  const folder = createDraftsFolder(root);
  folder.read();
  folder.write({
    [DRAFTS_KEY]: [
      draft("a", "Plan the trip", {
        attached: [
          {
            kind: "file",
            mimeType: "image/png",
            name: "image.png",
            path: path.join(root, "Drafts", "2026-10-14", "image.png"),
            size: 3,
          },
          { kind: "folder", path: "/Users/me/Trips" },
        ],
        topicId: "travel",
      }),
    ],
  });

  expect(tree()).toMatchInlineSnapshot(`
    [
      "Drafts/2026-10-14/DRAFT.md",
    ]
  `);
  expect(fs.readFileSync(path.join(root, "Drafts/2026-10-14/DRAFT.md"), "utf8"))
    .toMatchInlineSnapshot(`
      "---
      id: "a"
      created: 2026-10-14T12:00:00.000Z
      updated: 2026-10-14T12:00:00.000Z
      topic: "travel"
      attached:
        - path: "image.png"
          kind: file
          name: "image.png"
          mediaType: "image/png"
          size: 3
        - path: "/Users/me/Trips"
          kind: folder
      ---

      Plan the trip
      "
    `);
});

it("reads back every draft it wrote, with the paths it was given", () => {
  const kept = [
    draft("a", "Plan the trip", {
      attached: [{ kind: "folder", path: "/Users/me/Trips" }],
      topicId: "travel",
    }),
    draft("b", "A reply", { chatId: "2026-10-14-a-chat" }),
  ];
  createDraftsFolder(root).write({ [DRAFTS_KEY]: kept });

  expect(createDraftsFolder(root).read()).toEqual({ [DRAFTS_KEY]: kept });
});

it("keeps what was pasted into a draft by a path inside its own folder", () => {
  const folder = createDraftsFolder(root);
  const dir = draftDirOf(root, "a");
  fs.writeFileSync(path.join(dir, "image.png"), "png");
  folder.write({
    [DRAFTS_KEY]: [
      draft("a", "Look", {
        attached: [
          {
            kind: "file",
            mimeType: "image/png",
            name: "image.png",
            path: path.join(dir, "image.png"),
            size: 3,
          },
        ],
      }),
    ],
  });

  // Relative in the file, so the folder can be carried anywhere.
  expect(fs.readFileSync(path.join(dir, "DRAFT.md"), "utf8")).toContain(
    'path: "image.png"',
  );
  // And absolute again when the window reads it.
  expect(createDraftsFolder(root).read()[DRAFTS_KEY]).toMatchObject([
    { attached: [{ path: path.join(dir, "image.png") }] },
  ]);
});

it("writes nothing for a box opened and left alone", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "   ")] });

  expect(tree()).toEqual([]);

  // And writes it the moment there is something in it to keep.
  folder.write({ [DRAFTS_KEY]: [draft("a", "Plan the trip")] });

  expect(tree()).toEqual([path.join(folderOf("a"), "DRAFT.md")]);
});

it("reads drafts oldest first and skips folders that are not drafts", () => {
  createDraftsFolder(root).write({
    [DRAFTS_KEY]: [
      draft("newer", "two", { createdAt: DAY + 2 }),
      draft("older", "one", { createdAt: DAY + 1 }),
    ],
  });
  fs.mkdirSync(path.join(root, "Drafts", "stray"));
  fs.writeFileSync(path.join(root, "Drafts", "notes.md"), "mine");

  expect(createDraftsFolder(root).read()).toEqual({
    [DRAFTS_KEY]: [
      draft("older", "one", { createdAt: DAY + 1 }),
      draft("newer", "two", { createdAt: DAY + 2 }),
    ],
  });
});

it("takes away the draft no longer kept, with what was pasted into it", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one"), draft("b", "two")] });
  const gone = folderOf("a");
  fs.writeFileSync(path.join(root, gone, "image.png"), "png");
  folder.write({
    [DRAFTS_KEY]: [
      draft("a", "one", {
        attached: [{ kind: "file", path: path.join(root, gone, "image.png") }],
      }),
      draft("b", "two"),
    ],
  });

  folder.write({ [DRAFTS_KEY]: [draft("b", "two")] });

  expect(tree()).toEqual([path.join(folderOf("b"), "DRAFT.md")]);
});

it("rewrites only the draft that changed", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one"), draft("b", "two")] });
  const b = path.join(root, folderOf("b"), "DRAFT.md");
  fs.rmSync(b);

  folder.write({ [DRAFTS_KEY]: [draft("a", "one more"), draft("b", "two")] });

  expect(fs.existsSync(b)).toBe(false);
  expect(
    fs.readFileSync(path.join(root, folderOf("a"), "DRAFT.md"), "utf8"),
  ).toContain("one more");
});

it("leaves a value that is not a list of drafts unwritten", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one")] });

  folder.write({ [DRAFTS_KEY]: "nonsense" });

  expect(tree()).toEqual([path.join(folderOf("a"), "DRAFT.md")]);
});

it("reconciles changes made on disk and ignores its own writes", () => {
  const folder = createDraftsFolder(root);
  folder.read();
  const kept = [draft("a", "one"), draft("b", "two"), draft("c", "three")];
  folder.write({ [DRAFTS_KEY]: kept });
  expect(folder.reconcile({ [DRAFTS_KEY]: kept })).toBeUndefined();

  const edited = path.join(root, folderOf("a"), "DRAFT.md");
  fs.writeFileSync(
    edited,
    fs.readFileSync(edited, "utf8").replace("one", "edited elsewhere"),
  );
  fs.rmSync(path.join(root, folderOf("b")), { recursive: true });
  const typed = draft("c", "typed, not yet written");

  expect(folder.reconcile({ [DRAFTS_KEY]: [kept[0], kept[1], typed] })).toEqual(
    { [DRAFTS_KEY]: [draft("a", "edited elsewhere"), typed] },
  );
});

it("takes in a draft folder copied in from elsewhere", () => {
  const folder = createDraftsFolder(root);
  folder.read();
  const dir = path.join(root, "Drafts", "2026-10-15");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "DRAFT.md"),
    '---\nid: "new"\ncreated: 2026-10-15T12:00:00.000Z\nupdated: 2026-10-15T12:00:00.000Z\n---\n\nFrom my phone.\n',
  );

  expect(folder.reconcile({ [DRAFTS_KEY]: [] })).toEqual({
    [DRAFTS_KEY]: [
      draft("new", "From my phone.", {
        createdAt: Date.parse("2026-10-15T12:00:00.000Z"),
        updatedAt: Date.parse("2026-10-15T12:00:00.000Z"),
      }),
    ],
  });
});

it("watches without making the drafts folder, and calls back once a draft makes it", async () => {
  const folder = createDraftsFolder(root);
  folder.read();
  const onChange = vi.fn();
  const stop = folder.watch(onChange);
  try {
    expect(fs.readdirSync(root)).toEqual([]);
    folder.write({ [DRAFTS_KEY]: [draft("a", "Plan the trip")] });
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
  } finally {
    stop();
  }
});
