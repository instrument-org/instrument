import {
  barItems,
  type BookmarkOp,
  type BookmarksSnapshot,
  OTHER_ROOT,
  rootItems,
} from "@/shared/bookmarks";
import {
  type DeviceId,
  newDeviceId,
  openSyncedStore,
  type SyncedStore,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
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

async function bookmarksOf(device: DeviceId, now?: () => number) {
  const heard: BookmarksSnapshot[] = [];
  const store = await synced(device, now);
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

  it("applies batches sent together each to what the one before wrote", async () => {
    const { bookmarks } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [{ bookmark: page("a", 0), type: "add" }],
      seq: 1,
    });
    await Promise.all([
      bookmarks.apply({
        client: "w1",
        ops: [{ id: "a", title: "Docs", type: "rename" }],
        seq: 2,
      }),
      bookmarks.apply({
        client: "w1",
        ops: [{ id: "a", order: 5, type: "move" }],
        seq: 3,
      }),
    ]);
    const reread = await bookmarksOf(HERE);
    expect(reread.bookmarks.snapshot().bookmarks).toEqual([
      { ...page("a", 5), title: "Docs" },
    ]);
  });

  it("writes a bookmark's new address over its key, keeping its name and place", async () => {
    const { bookmarks } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [{ bookmark: page("a", 0), type: "add" }],
      seq: 1,
    });
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "a", type: "setUrl", url: "https://example.org/new" }],
      seq: 2,
    });
    const reread = await bookmarksOf(HERE);
    expect(reread.bookmarks.snapshot().bookmarks).toEqual([
      { ...page("a", 0), url: "https://example.org/new" },
    ]);
  });

  it("acks a batch that changes nothing", async () => {
    const { bookmarks, heard } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "gone", type: "remove" }],
      seq: 1,
    });
    expect(heard).toEqual([{ acks: { w1: 1 }, bookmarks: [], folders: [] }]);
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

  it("keeps an app address, and reads a value naming a place as one on the bar", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    const chat = { ...page("c", 3), url: "instrument://chat/abc" };
    await bookmarks.apply({
      client: "w1",
      ops: [{ bookmark: chat, type: "add" }],
      seq: 1,
    });
    await store.apply([
      {
        key: "bookmark/old",
        t: "set",
        value: { order: 1, title: "Old", url: "https://old.example/" },
      },
      {
        key: "bookmark/side",
        t: "set",
        value: {
          order: 2,
          title: "Side",
          url: "https://side.example/",
          where: "sidebar",
        },
      },
    ]);
    expect(bookmarks.snapshot().bookmarks).toEqual([
      { id: "old", order: 1, title: "Old", url: "https://old.example/" },
      { id: "side", order: 2, title: "Side", url: "https://side.example/" },
      { id: "c", order: 3, title: "Page c", url: "instrument://chat/abc" },
    ]);
    expect(store.entries().get("bookmark/c")).toEqual({
      order: 3,
      title: "Page c",
      url: "instrument://chat/abc",
    });
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
      folders: [],
    });
  });
});

describe("folders", () => {
  /** A clock each test moves by hand, so which device's change is newer is the test's to say. */
  function clock(start: number) {
    let now = start;
    return {
      now: () => now,
      set: (at: number) => {
        now = at;
      },
    };
  }

  const work = { id: "f", order: 5, title: "Work" };

  /** The bar as one line per item, a folder's contents in brackets. */
  function drawn(snapshot: BookmarksSnapshot): string[] {
    return barItems(snapshot).map((item) =>
      item.kind === "folder"
        ? `${item.folder.title} [${item.items.map((each) => each.id).join(" ")}]`
        : item.bookmark.id,
    );
  }

  /** Two devices on one workspace, each with its own clock. */
  async function twoDevices() {
    const hereClock = clock(Date.parse("2026-11-01T09:00:00Z"));
    const thereClock = clock(Date.parse("2026-11-01T09:00:00Z"));
    const here = await bookmarksOf(HERE, hereClock.now);
    const there = await bookmarksOf(THERE, thereClock.now);
    let seq = 0;
    const send = (side: typeof here, ops: BookmarkOp[]) =>
      side.bookmarks.apply({ client: "w", ops, seq: (seq += 1) });
    const sync = async () => {
      await here.store.look();
      await there.store.look();
    };
    return { here, hereClock, send, sync, there, thereClock };
  }

  it("writes a folder as a key of its own and a filed bookmark with its folder", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { folder: work, type: "addFolder" },
        { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
        { bookmark: page("b", 1), type: "add" },
      ],
      seq: 1,
    });
    expect(store.entries()).toEqual(
      new Map<string, unknown>([
        [
          "bookmark/a",
          {
            folder: "f",
            order: 0,
            title: "Page a",
            url: "https://example.com/a",
          },
        ],
        [
          "bookmark/b",
          { order: 1, title: "Page b", url: "https://example.com/b" },
        ],
        ["folder/f", { order: 5, title: "Work" }],
      ]),
    );
    expect(drawn(bookmarks.snapshot())).toEqual(["b", "Work [a]"]);
    // Out onto the bar, the folder goes from its value.
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "a", order: 9, type: "move" }],
      seq: 2,
    });
    expect(store.get("bookmark/a")).toEqual({
      order: 9,
      title: "Page a",
      url: "https://example.com/a",
    });
  });

  it("deletes a folder's bookmarks with it, a line each", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { folder: work, type: "addFolder" },
        { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
        { bookmark: page("b", 1), type: "add" },
      ],
      seq: 1,
    });
    await bookmarks.apply({
      client: "w1",
      ops: [{ id: "f", type: "remove" }],
      seq: 2,
    });
    expect([...store.entries().keys()]).toEqual(["bookmark/b"]);
  });

  it("keeps a bookmark filed on one device in a folder another removed at once, on the bar", async () => {
    const { here, hereClock, send, sync, there, thereClock } =
      await twoDevices();
    await send(here, [
      { folder: work, type: "addFolder" },
      { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
      { bookmark: page("x", 1), type: "add" },
    ]);
    await sync();
    // Neither has seen the other's change yet.
    hereClock.set(Date.parse("2026-11-01T10:00:00Z"));
    await send(here, [{ id: "f", type: "remove" }]);
    thereClock.set(Date.parse("2026-11-01T10:00:05Z"));
    await send(there, [{ folder: "f", id: "x", order: 0, type: "move" }]);
    await sync();
    expect(drawn(here.bookmarks.snapshot())).toEqual(["x"]);
    expect(here.bookmarks.snapshot()).toEqual({
      ...there.bookmarks.snapshot(),
      acks: here.bookmarks.snapshot().acks,
    });
  });

  it("keeps a bookmark renamed on one device after another removed its folder, on the bar", async () => {
    const { here, hereClock, send, sync, there, thereClock } =
      await twoDevices();
    await send(here, [
      { folder: work, type: "addFolder" },
      { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
    ]);
    await sync();
    hereClock.set(Date.parse("2026-11-01T10:00:00Z"));
    await send(here, [{ id: "f", type: "remove" }]);
    thereClock.set(Date.parse("2026-11-01T10:00:05Z"));
    await send(there, [{ id: "a", title: "Kept", type: "rename" }]);
    await sync();
    for (const side of [here, there]) {
      expect(side.bookmarks.snapshot().bookmarks).toEqual([
        { ...page("a", 0), folder: "f", title: "Kept" },
      ]);
      expect(drawn(side.bookmarks.snapshot())).toEqual(["a"]);
    }
  });

  it("comes to the same folders on both devices whichever change is newer", async () => {
    const { here, hereClock, send, sync, there, thereClock } =
      await twoDevices();
    await send(here, [
      { folder: work, type: "addFolder" },
      { bookmark: page("a", 0), type: "add" },
      { bookmark: page("b", 1), type: "add" },
    ]);
    await sync();
    hereClock.set(Date.parse("2026-11-01T10:00:09Z"));
    await send(here, [
      { id: "f", title: "Here", type: "rename" },
      { folder: "f", id: "a", order: 0, type: "move" },
    ]);
    thereClock.set(Date.parse("2026-11-01T10:00:01Z"));
    await send(there, [
      { id: "f", title: "There", type: "rename" },
      { folder: "f", id: "b", order: 0, type: "move" },
      { id: "a", order: 7, type: "move" },
    ]);
    await sync();
    expect(drawn(here.bookmarks.snapshot())).toEqual(["Here [a b]"]);
    expect(drawn(there.bookmarks.snapshot())).toEqual(["Here [a b]"]);
  });

  it("writes back what a later build added to a value as it was found", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await store.apply([
      {
        key: "bookmark/a",
        t: "set",
        value: { color: "red", order: 0, title: "A", url: "https://a/" },
      },
      {
        key: "folder/f",
        t: "set",
        value: { folder: "g", order: 1, title: "Inner" },
      },
      { key: "folder/g", t: "set", value: { order: 2, title: "Outer" } },
    ]);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { folder: "f", id: "a", order: 0, type: "move" },
        { id: "f", title: "Renamed", type: "rename" },
      ],
      seq: 1,
    });
    expect(store.get("bookmark/a")).toEqual({
      color: "red",
      folder: "f",
      order: 0,
      title: "A",
      url: "https://a/",
    });
    // A folder in a folder, which this build does not nest, shows on the
    // bar and keeps where the later build put it.
    expect(store.get("folder/f")).toEqual({
      folder: "g",
      order: 1,
      title: "Renamed",
    });
    expect(drawn(bookmarks.snapshot())).toEqual(["Renamed [a]", "Outer []"]);
  });

  it("reads folders that name each other, or a bookmark naming nothing it can be in, without losing any", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await store.apply([
      {
        key: "folder/f",
        t: "set",
        value: { folder: "g", order: 0, title: "F" },
      },
      {
        key: "folder/g",
        t: "set",
        value: { folder: "f", order: 1, title: "G" },
      },
      { key: "folder/bad", t: "set", value: { title: 4 } },
      {
        key: "bookmark/a",
        t: "set",
        value: { folder: "a", order: 0, title: "", url: "u" },
      },
      {
        key: "bookmark/b",
        t: "set",
        value: { folder: 12, order: 1, title: "", url: "u" },
      },
      {
        key: "bookmark/c",
        t: "set",
        value: { folder: "g", order: 2, title: "", url: "u" },
      },
    ]);
    expect(drawn(bookmarks.snapshot())).toEqual(["a", "F []", "b", "G [c]"]);
  });

  it("leaves a build from before folders every bookmark, on its bar", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { folder: work, type: "addFolder" },
        { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
        { bookmark: page("b", 1), type: "add" },
      ],
      seq: 1,
    });
    // How that build reads the store: `bookmark/` keys, through a schema
    // that passes over fields it does not know.
    const Former = z.object({
      order: z.number(),
      title: z.string(),
      url: z.string().min(1),
    });
    const former = [...store.entries("bookmark/")].flatMap(([key, value]) => {
      const parsed = Former.safeParse(value);
      return parsed.success ? [key] : [];
    });
    expect(former).toEqual(["bookmark/a", "bookmark/b"]);
    // And what it writes when it renames one: the value without its folder,
    // which takes the bookmark out onto the bar everywhere.
    await store.apply([
      {
        key: "bookmark/a",
        t: "set",
        value: { order: 0, title: "Renamed", url: "https://example.com/a" },
      },
    ]);
    expect(drawn(bookmarks.snapshot())).toEqual(["a", "b", "Work []"]);
  });

  it("writes All Bookmarks' root on its folders and loose bookmarks, and reads any other root as the bar", async () => {
    const { bookmarks, store } = await bookmarksOf(HERE);
    await bookmarks.apply({
      client: "w1",
      ops: [
        { folder: { ...work, root: OTHER_ROOT }, type: "addFolder" },
        { bookmark: { ...page("a", 0), folder: "f" }, type: "add" },
        { bookmark: { ...page("b", 1), root: OTHER_ROOT }, type: "add" },
      ],
      seq: 1,
    });
    expect(store.get("folder/f")).toEqual({
      order: 5,
      root: OTHER_ROOT,
      title: "Work",
    });
    expect(store.get("bookmark/b")).toEqual({
      order: 1,
      root: OTHER_ROOT,
      title: "Page b",
      url: "https://example.com/b",
    });
    expect(drawn(bookmarks.snapshot())).toEqual([]);
    expect(
      rootItems(bookmarks.snapshot(), OTHER_ROOT).map((item) =>
        item.kind === "folder" ? item.folder.id : item.bookmark.id,
      ),
    ).toEqual(["b", "f"]);
    await store.apply([
      {
        key: "bookmark/c",
        t: "set",
        value: { order: 2, root: "elsewhere", title: "C", url: "u" },
      },
    ]);
    expect(drawn(bookmarks.snapshot())).toEqual(["c"]);
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

  it("reads the file off the main thread", async () => {
    write({ "bookmarks.v1": [{ id: "a", title: "A", url: "https://a/" }] });
    const readSync = vi.spyOn(fs, "readFileSync");
    onTestFinished(() => readSync.mockRestore());
    expect(await importBookmarksFile(file(), await synced(HERE))).toBe(1);
    expect(readSync).not.toHaveBeenCalled();
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
