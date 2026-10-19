import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKeptStateStore, rewriteFolderAddresses } from "./kept-state";

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
  const store = createKeptStateStore(() => dir);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.set("view", "zoom.v1", 1.25);
  expect(fs.readdirSync(dir)).toEqual([]);

  store.flush();

  expect(fs.readdirSync(dir).toSorted()).toMatchInlineSnapshot(`
    [
      "layout.json",
      "view.json",
    ]
  `);
  expect(read("view.json")).toEqual({ "zoom.v1": 1.25 });
  expect(createKeptStateStore(() => dir).snapshot()).toEqual({
    bookmarks: {},
    layout: { "app-tabs.v2": { tabs: [] } },
    view: { "zoom.v1": 1.25 },
  });
});

it("writes each file into the folder named for it, making the folder", () => {
  const travels = path.join(dir, "workspace");
  const stays = path.join(dir, "machine");
  const dirOf = (file: string) => (file === "bookmarks" ? travels : stays);
  const store = createKeptStateStore(dirOf);
  store.set("bookmarks", "bookmarks.v1", [{ url: "https://example.com" }]);
  store.set("layout", "app-tabs.v2", { tabs: [] });
  store.set("view", "zoom.v1", 1.25);

  store.flush();

  expect(fs.readdirSync(travels)).toEqual(["bookmarks.json"]);
  expect(fs.readdirSync(stays).toSorted()).toEqual([
    "layout.json",
    "view.json",
  ]);
  expect(createKeptStateStore(dirOf).snapshot()).toMatchObject({
    bookmarks: { "bookmarks.v1": [{ url: "https://example.com" }] },
    view: { "zoom.v1": 1.25 },
  });
});

it("rewrites only the files that changed", () => {
  const store = createKeptStateStore(() => dir);
  store.set("bookmarks", "bookmarks.v1", []);
  store.flush();
  store.set("view", "zoom.v1", 2);
  store.flush();
  fs.rmSync(path.join(dir, "bookmarks.json"));

  store.set("view", "zoom.v1", 1);
  store.flush();

  expect(fs.existsSync(path.join(dir, "bookmarks.json"))).toBe(false);
});

it("removes a key set to undefined", () => {
  const store = createKeptStateStore(() => dir);
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

  expect(createKeptStateStore(() => dir).snapshot()).toMatchObject({
    layout: {},
    view: { "zoom.v1": 1.5 },
  });
});

it("leaves no temporary file behind", () => {
  const store = createKeptStateStore(() => dir);
  store.set("bookmarks", "bookmarks.v1", []);
  store.flush();

  expect(fs.readdirSync(dir)).toEqual(["bookmarks.json"]);
});

it("reads a file through its own reader as it loads", () => {
  fs.writeFileSync(
    path.join(dir, "layout.json"),
    JSON.stringify({ "app-tabs.v2": { tabs: ["a"] } }),
  );
  const store = createKeptStateStore(() => dir, {
    layout: (keys) => ({ ...keys, read: true }),
  });
  expect(store.snapshot().layout).toEqual({
    "app-tabs.v2": { tabs: ["a"] },
    read: true,
  });
});

describe("the Files addresses a window is left on", () => {
  /** Where the person left off: a tab per Files address, and one on a chat. */
  function writeLayout() {
    fs.writeFileSync(
      path.join(dir, "layout.json"),
      JSON.stringify({
        "window-tabs.v9": {
          tabs: [
            {
              href: `/files?path=&root=${encodeURIComponent("/data/workspace/Chats/Quiet dishwashers")}`,
            },
            {
              href: `/files?file=${encodeURIComponent("/data/workspace/report.pdf")}&path=&root=~`,
            },
            { href: "/files?path=Documents%2F&root=~" },
            { href: "/chats/c1" },
          ],
        },
        "zoom.v1": 1,
      }),
    );
  }

  const moved = (hostPath: string) =>
    hostPath.replace("/data/workspace", "/Users/sam/Documents/Instrument");

  it("names each address's folder and file where a move took them", () => {
    writeLayout();

    const done = rewriteFolderAddresses(dir, moved);

    expect(createKeptStateStore(() => dir).snapshot().layout)
      .toMatchInlineSnapshot(`
        {
          "window-tabs.v9": {
            "tabs": [
              {
                "href": "/files?path=&root=%2FUsers%2Fsam%2FDocuments%2FInstrument%2FChats%2FQuiet%20dishwashers",
              },
              {
                "href": "/files?file=%2FUsers%2Fsam%2FDocuments%2FInstrument%2Freport.pdf&path=&root=~",
              },
              {
                "href": "/files?path=Documents%2F&root=~",
              },
              {
                "href": "/chats/c1",
              },
            ],
          },
          "zoom.v1": 1,
        }
      `);
    expect(done).toEqual([
      `wrote 2 address(es) where they went in ${path.join(dir, "layout.json")}`,
    ]);
  });

  it("writes nothing on the run after, and nothing where there is no file", () => {
    expect(rewriteFolderAddresses(dir, moved)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "layout.json"))).toBe(false);
    writeLayout();
    rewriteFolderAddresses(dir, moved);
    const written = fs.readFileSync(path.join(dir, "layout.json"), "utf8");

    expect(rewriteFolderAddresses(dir, moved)).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "layout.json"), "utf8")).toBe(
      written,
    );
  });
});
