import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createKeptStateStore } from "./kept-state";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kept-state-"));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

const read = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

it("writes each key to its file on flush, and reads them back in a new store", () => {
  const store = createKeptStateStore(dir);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.set("drafts", "drafts.v2", [{ id: "d" }]);
  store.set("view", "zoom.v1", 1.25);
  expect(fs.readdirSync(dir)).toEqual([]);

  store.flush();

  expect(fs.readdirSync(dir).toSorted()).toMatchInlineSnapshot(`
    [
      "drafts.json",
      "layout.json",
      "view.json",
    ]
  `);
  expect(read("view.json")).toEqual({ "zoom.v1": 1.25 });
  expect(createKeptStateStore(dir).snapshot()).toEqual({
    bookmarks: {},
    drafts: { "drafts.v2": [{ id: "d" }] },
    layout: { "app-tabs.v2": { tabs: [] } },
    view: { "zoom.v1": 1.25 },
  });
});

it("rewrites only the files that changed", () => {
  const store = createKeptStateStore(dir);
  store.set("drafts", "drafts.v2", []);
  store.flush();
  store.set("view", "zoom.v1", 2);
  store.flush();
  fs.rmSync(path.join(dir, "drafts.json"));

  store.set("view", "zoom.v1", 1);
  store.flush();

  expect(fs.existsSync(path.join(dir, "drafts.json"))).toBe(false);
});

it("removes a key set to undefined", () => {
  const store = createKeptStateStore(dir);
  store.set("view", "zoom.v1", 2);
  store.set("view", "pane-share.v1", 0.5);
  store.set("view", "zoom.v1", undefined);
  store.flush();

  expect(read("view.json")).toEqual({ "pane-share.v1": 0.5 });
});

it.each([
  ["not JSON", "{ tabs"],
  ["JSON that is not an object", "[1, 2]"],
])("reads a file that is %s as empty", (_, contents) => {
  fs.writeFileSync(path.join(dir, "layout.json"), contents);
  fs.writeFileSync(
    path.join(dir, "view.json"),
    JSON.stringify({ "zoom.v1": 1.5 }),
  );

  expect(createKeptStateStore(dir).snapshot()).toMatchObject({
    layout: {},
    view: { "zoom.v1": 1.5 },
  });
});

it("leaves no temporary file behind", () => {
  const store = createKeptStateStore(dir);
  store.set("bookmarks", "bookmarks.v1", []);
  store.flush();

  expect(fs.readdirSync(dir)).toEqual(["bookmarks.json"]);
});
