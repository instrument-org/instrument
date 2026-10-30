import { type BookmarksSnapshot } from "@/shared/bookmarks";
import {
  type DeviceId,
  newDeviceId,
  openSyncedStore,
  type SyncedStore,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createBookmarkStore, importBookmarksFile } from "./bookmark-store";

const HERE = newDeviceId();
const THERE = newDeviceId();
const LineSchema = z.object({ key: z.string(), t: z.string() });

let dir = "";
const opened: SyncedStore[] = [];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bookmarks-")));
});

afterEach(() => {
  for (const store of opened.splice(0)) {
    store.close();
  }
  fs.rmSync(dir, { force: true, recursive: true });
});

async function synced(device: DeviceId, now = () => Date.now()) {
  const store = await openSyncedStore({
    device,
    devicesDir: path.join(dir, "devices"),
    domain: "bookmarks",
    now,
    watch: false,
  });
  opened.push(store);
  return store;
}

async function bookmarksOf(device: DeviceId) {
  const heard: BookmarksSnapshot[] = [];
  const store = await synced(device);
  return {
    bookmarks: createBookmarkStore({
      onChange: (snapshot) => heard.push(snapshot),
      store,
    }),
    heard,
    store,
  };
}

const page = (id: string, order: number) => ({
  id,
  order,
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
});

describe("createBookmarkStore", () => {
  it("writes a window's ops as a key per bookmark and acks the batch", async () => {
    const { bookmarks, heard } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { bookmark: page("a", 0), type: "add" },
        { bookmark: page("b", 1), type: "add" },
      ],
      seq: 1,
    });
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "a", title: "Docs", type: "rename" }],
      seq: 2,
    });
    expect(heard.map((snapshot) => snapshot.acks)).toEqual([
      { w1: 1 },
      { w1: 2 },
    ]);
    expect(bookmarks.snapshot().bookmarks).toEqual([
      { ...page("a", 0), title: "Docs" },
      page("b", 1),
    ]);
    const lines = fs
      .readFileSync(path.join(dir, "devices", HERE, "bookmarks.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => LineSchema.parse(JSON.parse(line)));
    expect(lines.map((line) => `${line.t} ${line.key}`)).toEqual([
      "set bookmark/a",
      "set bookmark/b",
      "set bookmark/a",
    ]);
  });

  it("acks a batch that changes nothing", async () => {
    const { bookmarks, heard } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "gone", type: "remove" }],
      seq: 1,
    });
    expect(heard).toEqual([{ acks: { w1: 1 }, bookmarks: [] }]);
  });

  it("tells the windows what another device changed", async () => {
    const here = await bookmarksOf(HERE);
    const there = await bookmarksOf(THERE);
    await there.bookmarks.apply({
      client: "w9",
      ops: [{ bookmark: page("x", 0), type: "add" }],
      seq: 1,
    });
    await here.store.look();
    expect(here.heard.at(-1)?.bookmarks).toEqual([page("x", 0)]);
    await here.bookmarks.apply({
      client: "w1",
      ops: [{ id: "x", type: "remove" }],
      seq: 1,
    });
    await there.store.look();
    expect(there.heard.at(-1)?.bookmarks).toEqual([]);
  });

  it("passes over a value it cannot read as a bookmark", async () => {
    const store = await synced(HERE);
    await store.apply([
      { key: "bookmark/odd", t: "set", value: { title: 3 } },
      {
        key: "bookmark/ok",
        t: "set",
        value: { order: 0, title: "", url: "u" },
      },
    ]);
    expect(
      createBookmarkStore({ onChange: () => undefined, store }).snapshot(),
    ).toEqual({
      acks: {},
      bookmarks: [{ id: "ok", order: 0, title: "", url: "u" }],
    });
  });
});

describe("importBookmarksFile", () => {
  const file = () => path.join(dir, "bookmarks.json");
  const write = (value: unknown) => {
    fs.writeFileSync(file(), JSON.stringify(value));
    const changed = new Date("2026-10-01T09:00:00Z");
    fs.utimesSync(file(), changed, changed);
  };

  it("takes in the bookmarks in their order and removes the file", async () => {
    write({
      "bookmarks.v1": [
        { id: "a", title: "A", url: "https://a.example/" },
        { url: "no id" },
        { id: "b", url: "https://b.example/" },
      ],
    });
    const store = await synced(HERE);
    expect(await importBookmarksFile(file(), store)).toBe(2);
    expect(fs.existsSync(file())).toBe(false);
    expect(
      createBookmarkStore({ onChange: () => undefined, store }).snapshot()
        .bookmarks,
    ).toEqual([
      { id: "a", order: 0, title: "A", url: "https://a.example/" },
      { id: "b", order: 1, title: "", url: "https://b.example/" },
    ]);
  });

  it("writes them as of the file's last change, so a later remove elsewhere stands", async () => {
    write({ "bookmarks.v1": [{ id: "a", title: "A", url: "https://a/" }] });
    const there = await synced(THERE);
    await importBookmarksFile(file(), there);
    await there.apply([{ key: "bookmark/a", t: "del" }]);
    // The same file reaches this device before its removal does.
    write({ "bookmarks.v1": [{ id: "a", title: "A", url: "https://a/" }] });
    const here = await synced(HERE);
    await importBookmarksFile(file(), here);
    expect(here.entries()).toEqual(new Map());
  });

  it("leaves a file it cannot read where it is", async () => {
    fs.writeFileSync(file(), "not json");
    expect(
      await importBookmarksFile(file(), await synced(HERE)),
    ).toBeUndefined();
    expect(fs.existsSync(file())).toBe(true);
  });

  it("does nothing without a file", async () => {
    expect(
      await importBookmarksFile(file(), await synced(HERE)),
    ).toBeUndefined();
  });
});
