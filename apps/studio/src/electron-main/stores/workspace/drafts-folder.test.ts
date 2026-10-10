import { DRAFTS_KEY } from "@/shared/kept-state";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createDraftsFolder } from "./drafts-folder";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-folder-"));
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

/** Every file under the root, by its path there. */
function tree(): string[] {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)),
    )
    .toSorted();
}

const draft = (id: string, words: string, extra: object = {}) => ({
  createdAt: 1,
  id,
  updatedAt: 1,
  words,
  ...extra,
});

it("writes a folder per draft, words in draft.md and the rest in its settings", () => {
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
            path: path.join(root, "a", "image.png"),
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
      "a/.instrument/settings.json",
      "a/draft.md",
    ]
  `);
  expect(fs.readFileSync(path.join(root, "a/draft.md"), "utf8")).toBe(
    "Plan the trip",
  );
  expect(
    JSON.parse(
      fs.readFileSync(path.join(root, "a/.instrument/settings.json"), "utf8"),
    ),
  ).toMatchInlineSnapshot(`
    {
      "attached": [
        {
          "kind": "file",
          "mimeType": "image/png",
          "name": "image.png",
          "path": "image.png",
          "size": 3,
        },
        {
          "kind": "folder",
          "path": "/Users/me/Trips",
        },
      ],
      "createdAt": 1,
      "topicId": "travel",
      "updatedAt": 1,
    }
  `);
  expect(createDraftsFolder(root).read()).toEqual({
    [DRAFTS_KEY]: [
      draft("a", "Plan the trip", {
        attached: [
          {
            kind: "file",
            mimeType: "image/png",
            name: "image.png",
            path: path.join(root, "a", "image.png"),
            size: 3,
          },
          { kind: "folder", path: "/Users/me/Trips" },
        ],
        topicId: "travel",
      }),
    ],
  });
});

it("reads drafts oldest first and skips folders that are not drafts", () => {
  const folder = createDraftsFolder(root);
  folder.write({
    [DRAFTS_KEY]: [
      draft("newer", "two", { createdAt: 2 }),
      draft("older", "one", { createdAt: 1 }),
    ],
  });
  fs.mkdirSync(path.join(root, "stray"));
  fs.writeFileSync(path.join(root, "notes.md"), "mine");

  expect(createDraftsFolder(root).read()).toEqual({
    [DRAFTS_KEY]: [
      draft("older", "one", { createdAt: 1 }),
      draft("newer", "two", { createdAt: 2 }),
    ],
  });
});

it("removes the folder of a draft no longer kept, with what was pasted into it", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one"), draft("b", "two")] });
  fs.writeFileSync(path.join(root, "a/image.png"), "png");

  folder.write({ [DRAFTS_KEY]: [draft("b", "two")] });

  expect(tree()).toEqual(["b/.instrument/settings.json", "b/draft.md"]);
});

it("rewrites only the files of the draft that changed", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one"), draft("b", "two")] });
  fs.rmSync(path.join(root, "b/draft.md"));

  folder.write({ [DRAFTS_KEY]: [draft("a", "one more"), draft("b", "two")] });

  expect(fs.existsSync(path.join(root, "b/draft.md"))).toBe(false);
  expect(fs.readFileSync(path.join(root, "a/draft.md"), "utf8")).toBe(
    "one more",
  );
});

it("leaves a value that is not a list of drafts unwritten", () => {
  const folder = createDraftsFolder(root);
  folder.write({ [DRAFTS_KEY]: [draft("a", "one")] });

  folder.write({ [DRAFTS_KEY]: "nonsense" });

  expect(tree()).toEqual(["a/.instrument/settings.json", "a/draft.md"]);
});

it("reconciles changes made on disk and ignores its own writes", () => {
  const folder = createDraftsFolder(root);
  folder.read();
  const kept = [draft("a", "one"), draft("b", "two"), draft("c", "three")];
  folder.write({ [DRAFTS_KEY]: kept });
  expect(folder.reconcile({ [DRAFTS_KEY]: kept })).toBeUndefined();

  fs.writeFileSync(path.join(root, "a/draft.md"), "edited elsewhere");
  fs.rmSync(path.join(root, "b"), { recursive: true });
  const typed = draft("c", "typed, not yet written");

  expect(folder.reconcile({ [DRAFTS_KEY]: [kept[0], kept[1], typed] })).toEqual(
    {
      [DRAFTS_KEY]: [draft("a", "edited elsewhere"), typed],
    },
  );
});

it("takes in a draft folder copied in from elsewhere", () => {
  const folder = createDraftsFolder(root);
  folder.read();
  fs.mkdirSync(path.join(root, "new/.instrument"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "new/.instrument/settings.json"),
    JSON.stringify({ createdAt: 5, updatedAt: 5 }),
  );

  expect(folder.reconcile({ [DRAFTS_KEY]: [] })).toEqual({
    [DRAFTS_KEY]: [draft("new", "", { createdAt: 5, updatedAt: 5 })],
  });
});
