import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { identityOf } from "../file-journal";
import { createLeftovers, finishLeftovers, type Leftover } from "./leftovers";

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(
    await fs.mkdtemp(path.join(tmpdir(), "placing-leftovers-")),
  );
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

// What a quit or crash left: a staging copy goes, an undone copy goes to the
// Trash, and anything not under its own prefix, or no longer the thing that
// was recorded, is left alone.
it("finishes what a quit left, and touches nothing it did not make", async () => {
  const at = (name: string) => path.join(dir, name);
  await fs.mkdir(at(".instrument-placing-t-0"));
  await fs.writeFile(at(".instrument-placing-t-0/part"), "part");
  await fs.writeFile(at(".instrument-undone-u-notes.txt"), "copy");
  await fs.writeFile(at(".instrument-undone-v-swapped.txt"), "someone else's");
  await fs.writeFile(at("notes.txt"), "the person's own");
  const undone = await identityOf(at(".instrument-undone-u-notes.txt"));
  let records: readonly Leftover[] = [
    { identity: null, kind: "staging", path: at(".instrument-placing-t-0") },
    {
      identity: undone,
      kind: "undone",
      path: at(".instrument-undone-u-notes.txt"),
    },
    // Recorded as something else: the file there now is not it.
    {
      identity: { dev: 0, ino: "0" },
      kind: "undone",
      path: at(".instrument-undone-v-swapped.txt"),
    },
    { identity: null, kind: "staging", path: at("notes.txt") },
  ];
  const trashed: string[] = [];

  await finishLeftovers(
    createLeftovers({
      read: () => records,
      write: (next) => {
        records = next;
      },
    }),
    {
      identity: identityOf,
      trash: async (where) => {
        trashed.push(path.basename(where));
        await fs.rm(where);
      },
    },
  );

  expect(trashed).toEqual([".instrument-undone-u-notes.txt"]);
  expect((await fs.readdir(dir)).toSorted()).toEqual([
    ".instrument-undone-v-swapped.txt",
    "notes.txt",
  ]);
  expect(records).toEqual([]);
});
