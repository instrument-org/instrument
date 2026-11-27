import {
  BOOKMARKS_CHANNEL,
  type BookmarkOpBatch,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import {
  newDeviceId,
  openSyncedStore,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBookmarkStore } from "./bookmark-store";
import { openBookmarks, serveBookmarks } from "./serve-bookmarks";

/** What main answers a window by, as `ipcMain` hands it over. */
type Handler = (event: { returnValue?: unknown }, batch?: unknown) => unknown;

const main = vi.hoisted(() => ({
  folder: "",
  handlers: new Map<string, Handler>(),
  told: [] as BookmarksSnapshot[],
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (_channel: string, snapshot: BookmarksSnapshot) => {
            main.told.push(snapshot);
          },
        },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      main.handlers.set(channel, handler);
    },
    on: (channel: string, handler: Handler) => {
      main.handlers.set(channel, handler);
    },
  },
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getWorkspaceFolder: () => main.folder,
}));
vi.mock("../lib/electron-logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const HERE = newDeviceId();
const THERE = newDeviceId();
const KEPT = {
  id: "kept",
  order: 0,
  title: "Trip plans",
  url: "https://trip.example/",
};

/** Lets a read waiting on a FIFO end, where one is waiting; none is fine. */
function endWaitingRead(fifo: string) {
  try {
    fs.closeSync(
      fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK),
    );
  } catch {
    // No read is waiting on it.
  }
}

let cleanUp: (() => void) | undefined;
afterEach(() => {
  cleanUp?.();
  cleanUp = undefined;
});

/** What another device wrote: its file of the bookmarks, with `KEPT` in it. */
async function anotherDevicesFile() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bookmarks-there-"));
  const synced = await openSyncedStore({
    device: THERE,
    devicesDir: scratch,
    domain: "bookmarks",
    watch: false,
  });
  await createBookmarkStore({ onChange: () => undefined, store: synced }).apply(
    { client: "there", ops: [{ bookmark: KEPT, type: "add" }], seq: 1 },
  );
  synced.close();
  const [name] = fs.readdirSync(path.join(scratch, THERE));
  const bytes = fs.readFileSync(path.join(scratch, THERE, name ?? ""));
  fs.rmSync(scratch, { force: true, recursive: true });
  return { bytes, name: name ?? "" };
}

describe("bookmarks a window asks for before they are read", () => {
  // Windows has no FIFO a path names.
  it.skipIf(process.platform === "win32")(
    "are none, marked loading, and a change waits for the read",
    async () => {
    main.folder = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "bookmarks-held-")),
    );
    const { devicesDir } = workspaceLayout(main.folder);
    const { bytes, name } = await anotherDevicesFile();
    // The other device's file a FIFO, so reading it waits until it is
    // written, as a synced folder's file can after a restart. Opening waits
    // on another device's file for 10 s at most, far longer than this holds
    // it; this device's own file would hold it for good, but every write
    // after the read goes to it.
    const fifo = path.join(devicesDir, THERE, name);
    fs.mkdirSync(path.dirname(fifo), { recursive: true });
    execFileSync("mkfifo", [fifo]);
    cleanUp = () => {
      endWaitingRead(fifo);
      fs.rmSync(main.folder, { force: true, recursive: true });
    };
    const ownFile = path.join(devicesDir, HERE, name);

    serveBookmarks();
    const opening = openBookmarks(HERE);
    const load = () => {
      const event: { returnValue?: unknown } = {};
      main.handlers.get(BOOKMARKS_CHANNEL.load)?.(event);
      return event.returnValue as BookmarksSnapshot;
    };
    expect(load()).toEqual({
      acks: {},
      bookmarks: [],
      folders: [],
      loading: true,
    });

    const batch: BookmarkOpBatch = {
      client: "window",
      ops: [
        {
          bookmark: {
            id: "new",
            order: 1,
            title: "New",
            url: "https://new.example/",
          },
          type: "add",
        },
      ],
      seq: 1,
    };
    let isApplied = false;
    const applying = Promise.resolve(
      main.handlers.get(BOOKMARKS_CHANNEL.apply)?.({}, batch),
    ).then(() => {
      isApplied = true;
    });
    await sleep(300);
    // Held: nothing written, nothing told, the read still waiting.
    expect(isApplied).toBe(false);
    expect(fs.existsSync(ownFile)).toBe(false);
    expect(main.told).toEqual([]);
    expect(load().loading).toBe(true);

    await fs.promises.writeFile(fifo, bytes);
    await opening;
    await applying;

    const read = load();
    expect(read.loading).toBeUndefined();
    expect(read.bookmarks.map((each) => each.id)).toEqual(["kept", "new"]);
    expect(main.told.map((each) => each.bookmarks.length)).toEqual([1, 2]);
    expect(main.told.every((each) => each.loading === undefined)).toBe(true);
    expect(fs.readFileSync(ownFile, "utf8")).toContain("https://new.example/");
    },
  );
});
