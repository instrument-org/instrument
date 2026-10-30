import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEVICE_A, DEVICE_B } from "../records/test-records";
import { withTempDir } from "../../test/helpers/temp-dir";
import { openSyncedStore, type SyncedStore } from "./synced-store";

const dir = withTempDir("synced-store");
const T0 = Date.parse("2026-10-19T12:00:00.000Z");

const opened: SyncedStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of opened.splice(0)) {
    store.close();
  }
});

async function open(
  device = DEVICE_A,
  options: { now?: () => number; watch?: boolean } = {},
) {
  const store = await openSyncedStore({
    device,
    devicesDir: dir.path,
    domain: "bookmarks",
    now: options.now ?? (() => T0),
    settleMs: 10,
    watch: options.watch ?? false,
  });
  opened.push(store);
  return store;
}

describe("openSyncedStore", () => {
  it("appends this device's changes to its own file and reads them back", async () => {
    const store = await open();
    const heard: string[][] = [];
    store.subscribe((keys) => heard.push([...keys]));
    await store.apply([
      { key: "bookmark/a", t: "set", value: { title: "A" } },
      { key: "bookmark/b", t: "set", value: { title: "B" } },
    ]);
    await store.apply([{ key: "bookmark/a", t: "del" }]);
    expect(heard).toEqual([["bookmark/a", "bookmark/b"], ["bookmark/a"]]);
    expect(store.entries()).toEqual(new Map([["bookmark/b", { title: "B" }]]));
    expect(
      fs.readFileSync(path.join(dir.path, DEVICE_A, "bookmarks.jsonl"), "utf8"),
    ).toMatchInlineSnapshot(`
      "{"t":"set","seq":0,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":"bookmark/a","value":{"title":"A"}}
      {"t":"set","seq":1,"at":"2026-10-19T12:00:00.000Z","device":"dev_AAAAAAAA","key":"bookmark/b","value":{"title":"B"}}
      {"t":"del","seq":2,"at":"2026-10-19T12:00:00.001Z","device":"dev_AAAAAAAA","key":"bookmark/a"}
      "
    `);
    store.close();
    const again = await open();
    expect(again.entries()).toEqual(new Map([["bookmark/b", { title: "B" }]]));
    await again.apply([{ key: "bookmark/c", t: "set", value: { title: "C" } }]);
    expect(
      fs
        .readFileSync(path.join(dir.path, DEVICE_A, "bookmarks.jsonl"), "utf8")
        .split("\n")
        .at(-2),
    ).toContain('"seq":3');
  });

  it("takes in another device's file and its conflict copies on a look", async () => {
    const a = await open(DEVICE_A);
    const b = await open(DEVICE_B, { now: () => T0 + 1000 });
    await a.apply([
      { key: "bookmark/x", t: "set", value: { title: "From A" } },
    ]);
    const heard: string[][] = [];
    b.subscribe((keys) => heard.push([...keys]));
    await b.look();
    expect(b.get("bookmark/x")).toEqual({ title: "From A" });
    await b.apply([
      { key: "bookmark/x", t: "set", value: { title: "Renamed on B" } },
    ]);
    await a.look();
    expect(a.get("bookmark/x")).toEqual({ title: "Renamed on B" });
    // A copy of b's file a sync engine kept beside it folds as the same lines.
    fs.copyFileSync(
      path.join(dir.path, DEVICE_B, "bookmarks.jsonl"),
      path.join(dir.path, DEVICE_B, "bookmarks 2.jsonl"),
    );
    const listener = vi.fn();
    a.subscribe(listener);
    await a.look();
    expect(listener).not.toHaveBeenCalled();
    expect(heard).toEqual([["bookmark/x"], ["bookmark/x"]]);
  });

  it("reads another device's file without a synchronous read", async () => {
    const a = await open(DEVICE_A);
    await a.apply([
      { key: "bookmark/x", t: "set", value: { title: "From A" } },
    ]);
    const readSync = vi.spyOn(fs, "readFileSync");
    const b = await open(DEVICE_B);
    expect(b.get("bookmark/x")).toEqual({ title: "From A" });
    expect(readSync).not.toHaveBeenCalled();
  });

  it("leaves other files in the devices folder alone", async () => {
    fs.mkdirSync(path.join(dir.path, DEVICE_B, "activity"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir.path, DEVICE_B, "activity", "2026-10.jsonl"),
      "{}\n",
    );
    fs.writeFileSync(
      path.join(dir.path, DEVICE_B, "preferences.jsonl"),
      "{}\n",
    );
    fs.mkdirSync(path.join(dir.path, "not-a-device"));
    fs.writeFileSync(
      path.join(dir.path, "not-a-device", "bookmarks.jsonl"),
      "{}\n",
    );
    const store = await open();
    expect(store.entries()).toEqual(new Map());
  });

  it("refuses a domain whose file could read as another's copy", async () => {
    await expect(
      openSyncedStore({
        device: DEVICE_A,
        devicesDir: dir.path,
        domain: "book-marks",
        watch: false,
      }),
    ).rejects.toThrow(/lowercase letters and digits/);
  });

  it("hears another device's file grow without being asked to look", async () => {
    const b = await open(DEVICE_B, { watch: true });
    const listener = vi.fn();
    b.subscribe(listener);
    const a = await open(DEVICE_A);
    await a.apply([
      { key: "bookmark/x", t: "set", value: { title: "From A" } },
    ]);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(new Set(["bookmark/x"]));
    });
    expect(b.get("bookmark/x")).toEqual({ title: "From A" });
  });
});
