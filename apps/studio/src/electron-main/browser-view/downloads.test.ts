import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { Session, WebContents } from "electron";

import { browserTargetOf, StoreId } from "@instrument-org/workspace/electron";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDownloads, listDownloads } from "./download-list";
import {
  applyDownloadBehavior,
  captureDownloadWillBeginGuid,
  routeGuestDownloads,
  saveAsFromPage,
} from "./downloads";
import { type BrowserEntry, createEntry } from "./entry";

// A person's download lands in their Downloads folder, and otherwise
// wherever they say. A temp home stands in for it, laid out as
// `home/Downloads`; a test that wants the folder to refuse the file points
// its path at a file instead.
const home = vi.hoisted(() => ({
  dir: "",
  downloads: "",
  workspace: "",
}));
vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "downloads") {
        return home.downloads;
      }
      if (name === "home") {
        return home.dir;
      }
      throw new Error(`unexpected path ${name}`);
    },
  },
}));
vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  getWorkspaceFolder: () => home.workspace,
  // Beside the folders a download lands in, so it refuses none of them.
  getUserDataDir: () => `${home.dir}/user-data`,
}));
// The download list's saved copy, in memory.
const saved = vi.hoisted(() => ({ downloads: [] as unknown[] }));
vi.mock("@/electron-main/stores/workspace/downloads", () => ({
  getDownloadsStore: () => ({
    get: () => saved.downloads,
    set: (_key: string, value: unknown[]) => {
      saved.downloads = value;
    },
  }),
}));

const TARGET_ID = browserTargetOf(StoreId.newTabId());

beforeEach(() => {
  home.dir = fs.mkdtempSync(path.join(os.tmpdir(), "downloads-test-"));
  home.downloads = path.join(home.dir, "Downloads");
  home.workspace = path.join(home.dir, "workspace");
});

afterEach(() => {
  clearDownloads();
  fs.rmSync(home.dir, { force: true, recursive: true });
  vi.restoreAllMocks();
});

interface FakeItem extends EventEmitter {
  cancel: ReturnType<typeof vi.fn>;
  getFilename: () => string;
  getReceivedBytes: () => number;
  getSavePath: () => string;
  getTotalBytes: () => number;
  getURL: () => string;
  getURLChain: () => string[];
  /** Where the transfer is writing, which the person's own pick also sets. */
  savePath: string;
  setSaveDialogOptions: ReturnType<typeof vi.fn>;
  setSavePath: ReturnType<typeof vi.fn>;
}

// A path no folder can be made at: its parent is a file.
function unwritableDir() {
  const blocker = path.join(home.dir, "blocker");
  fs.writeFileSync(blocker, "");
  return path.join(blocker, "downloads");
}

let webContentsCounter = 0;

// An entry with its guest bound, the state every entry is in once a download
// can reach it. Only the id matters: the handler attributes a download to a
// guest by it.
function makeEntry(targetId: BrowserTargetId = TARGET_ID): BrowserEntry {
  const entry = createEntry({
    partitionDir: "/tmp/partition" as AbsolutePath,
    targetId,
  });
  entry.webContents = { id: ++webContentsCounter } as WebContents;
  return entry;
}

function makeFakeItem({
  filename = "report.pdf",
  url = "https://example.com/report.pdf",
}: { filename?: string; url?: string } = {}): FakeItem {
  const emitter = new EventEmitter();
  const item: FakeItem = Object.assign(emitter, {
    cancel: vi.fn(),
    getFilename: () => filename,
    getReceivedBytes: () => 1024,
    getSavePath: () => item.savePath,
    getTotalBytes: () => 1024,
    getURL: () => url,
    getURLChain: () => [url],
    on: emitter.on.bind(emitter),
    savePath: "",
    setSaveDialogOptions: vi.fn(),
    setSavePath: vi.fn((to: string) => {
      item.savePath = to;
    }),
  });
  return item;
}

describe("applyDownloadBehavior", () => {
  it.each([
    { behavior: "allow" as const, expected: "/tmp/dl" },
    { behavior: "allowAndName" as const, expected: "/tmp/dl" },
  ])(
    "authorizes when behavior=$behavior with downloadPath",
    ({ behavior, expected }) => {
      const entry = makeEntry();
      applyDownloadBehavior(entry, { behavior, downloadPath: "/tmp/dl" });
      expect(entry.authorizedDownloadPath).toBe(expected);
    },
  );

  it.each([{ behavior: "deny" as const }, { behavior: "default" as const }])(
    "clears authorization when behavior=$behavior",
    ({ behavior }) => {
      const entry = makeEntry();
      entry.authorizedDownloadPath = "/tmp/dl";
      applyDownloadBehavior(entry, { behavior, downloadPath: "/tmp/dl" });
      expect(entry.authorizedDownloadPath).toBeNull();
    },
  );
});

describe("captureDownloadWillBeginGuid", () => {
  it("records guid keyed by url", () => {
    const entry = makeEntry();
    captureDownloadWillBeginGuid(entry, {
      frameId: "f",
      guid: "g-1",
      suggestedFilename: "x.pdf",
      url: "https://example.com/x.pdf",
    });
    expect(entry.pendingDownloadGuids.get("https://example.com/x.pdf")).toBe(
      "g-1",
    );
  });
});
// What the guest registry answers for the downloads: the entry bound to a
// guest, found by its contents id, and the document a guest loaded, as the
// fake guest's main frame names it.
function lookupIn(entries: Map<BrowserTargetId, BrowserEntry>) {
  const entryOf = (id: number | undefined) =>
    [...entries.values()].find((entry) => entry.webContents?.id === id);
  return {
    documentOf: (id: number | undefined) =>
      entryOf(id)?.webContents?.mainFrame.url,
    entryOf,
  };
}

// Every listener runs on every event, as on a real Session.
function makeSession() {
  type Listener = (
    event: unknown,
    item: FakeItem,
    webContents: WebContents,
  ) => void;
  const listeners: Record<string, Listener[]> = {};
  const session = {
    on(eventName: string, cb: Listener) {
      (listeners[eventName] ??= []).push(cb);
      return session;
    },
  } as unknown as Session;
  function trigger(item: FakeItem, from: BrowserEntry) {
    const callbacks = listeners["will-download"];
    if (!callbacks?.length) {
      throw new Error("will-download not registered");
    }
    if (!from.webContents) {
      throw new Error("entry has no guest bound");
    }
    for (const cb of callbacks) {
      cb({}, item, from.webContents);
    }
  }
  return { session, trigger };
}

describe("routeGuestDownloads", () => {
  describe("a download the person started", () => {
    it("lands in their Downloads folder under its own name", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);

      expect(item.cancel).not.toHaveBeenCalled();
      expect(item.setSavePath).toHaveBeenCalledWith(
        path.join(home.downloads, "report.pdf"),
      );
    });

    it("leaves nothing behind from proving the folder writable", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      trigger(makeFakeItem(), entry);

      expect(fs.readdirSync(home.downloads)).toEqual([]);
    });

    it("takes a numbered name when the folder already holds one", () => {
      fs.mkdirSync(home.downloads, { recursive: true });
      fs.writeFileSync(path.join(home.downloads, "report.pdf"), "");
      fs.writeFileSync(path.join(home.downloads, "report-2.pdf"), "");
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);

      expect(item.setSavePath).toHaveBeenCalledWith(
        path.join(home.downloads, "report-3.pdf"),
      );
    });

    it("asks where to put it when Downloads takes no file", () => {
      home.downloads = unwritableDir();
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);

      // No save path and no cancel is what puts the system's question up.
      expect(item.cancel).not.toHaveBeenCalled();
      expect(item.setSavePath).not.toHaveBeenCalled();
      expect(item.setSaveDialogOptions).toHaveBeenCalledWith({
        defaultPath: "report.pdf",
      });
      expect(listDownloads()[0]).toMatchObject({
        filename: "report.pdf",
        state: "progressing",
      });
    });

    it("lists the place the person picked once the file is there", () => {
      home.downloads = unwritableDir();
      const picked = path.join(home.dir, "Desktop", "report.pdf");
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);
      item.savePath = picked;
      item.emit("done", {}, "completed");

      expect(listDownloads()[0]).toMatchObject({
        path: picked,
        state: "completed",
      });
    });

    it.each([
      { listed: "completed" as const, state: "completed" as const },
      { listed: "failed" as const, state: "interrupted" as const },
      { listed: "canceled" as const, state: "cancelled" as const },
    ])(
      "lists where it ended up when it finishes $state",
      ({ listed, state }) => {
        const entries = new Map<BrowserTargetId, BrowserEntry>();
        const entry = makeEntry();
        entries.set(TARGET_ID, entry);
        const { session, trigger } = makeSession();
        routeGuestDownloads(session, lookupIn(entries));

        const item = makeFakeItem();
        trigger(item, entry);
        (item as unknown as EventEmitter).emit("done", {}, state);

        expect(listDownloads()[0]).toMatchObject({
          filename: "report.pdf",
          path: path.join(home.downloads, "report.pdf"),
          receivedBytes: 1024,
          state: listed,
          totalBytes: 1024,
          url: "https://example.com/report.pdf",
        });
      },
    );

    it("goes through no agent-browser event", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      const onEvent = vi.fn();
      entry.eventListeners.add(onEvent);
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);
      (item as unknown as EventEmitter).emit("done", {}, "completed");

      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("an image the person picked Save Image As… for", () => {
    it("asks where it goes and lists it, even with the agent's folder set", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entry.authorizedDownloadPath = "/tmp/dl";
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));
      const url = "https://example.com/cat.jpg";
      const guest = { downloadURL: vi.fn(), id: ++webContentsCounter };
      entry.webContents = guest as unknown as WebContents;

      saveAsFromPage(entry.webContents, url);
      const item = makeFakeItem({ filename: "cat.jpg", url });
      trigger(item, entry);

      expect(guest.downloadURL).toHaveBeenCalledWith(url);
      expect(item.setSavePath).not.toHaveBeenCalled();
      expect(item.setSaveDialogOptions).toHaveBeenCalledWith({
        defaultPath: "cat.jpg",
      });
      expect(entry.authorizedDownloadPath).toBe("/tmp/dl");
      expect(listDownloads()[0]).toMatchObject({
        filename: "cat.jpg",
        state: "progressing",
      });
    });

    it("asks only once, so the next download of it lands as usual", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));
      const url = "https://example.com/cat.jpg";
      const guest = { downloadURL: vi.fn(), id: ++webContentsCounter };
      entry.webContents = guest as unknown as WebContents;

      saveAsFromPage(entry.webContents, url);
      trigger(makeFakeItem({ filename: "cat.jpg", url }), entry);
      const again = makeFakeItem({ filename: "cat.jpg", url });
      trigger(again, entry);

      expect(again.setSavePath).toHaveBeenCalledWith(
        path.join(home.downloads, "cat.jpg"),
      );
    });
  });

  it("routes a download by the guest that started it when several share the session", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const authorized = makeEntry();
    authorized.authorizedDownloadPath = "/tmp/dl";
    const authorizedEvents = vi.fn();
    authorized.eventListeners.add(authorizedEvents);
    entries.set(TARGET_ID, authorized);

    const otherTargetId = browserTargetOf(StoreId.newTabId());
    const other = makeEntry(otherTargetId);
    const otherEvents = vi.fn();
    other.eventListeners.add(otherEvents);
    entries.set(otherTargetId, other);

    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    const fromAuthorized = makeFakeItem();
    trigger(fromAuthorized, authorized);
    expect(fromAuthorized.cancel).not.toHaveBeenCalled();
    expect(fromAuthorized.setSavePath).toHaveBeenCalledOnce();
    expect(authorizedEvents).toHaveBeenCalledWith(
      "Page.downloadWillBegin",
      expect.objectContaining({ frameId: TARGET_ID }),
    );
    expect(otherEvents).not.toHaveBeenCalled();

    // The other guest holds no authorization, so its download is the
    // person's: saved under its own name, and never reported to the agent's
    // listeners on either guest.
    const fromOther = makeFakeItem();
    trigger(fromOther, other);
    expect(fromOther.cancel).not.toHaveBeenCalled();
    expect(fromOther.setSavePath).toHaveBeenCalledWith(
      path.join(home.downloads, "report.pdf"),
    );
    expect(authorizedEvents).toHaveBeenCalledOnce();
    expect(otherEvents).not.toHaveBeenCalled();
  });

  it("cancels a download from a guest whose entry is gone", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const live = makeEntry();
    live.authorizedDownloadPath = "/tmp/dl";
    entries.set(TARGET_ID, live);
    const gone = makeEntry(browserTargetOf(StoreId.newTabId()));

    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    const item = makeFakeItem();
    trigger(item, gone);

    expect(item.cancel).toHaveBeenCalledOnce();
    expect(item.setSavePath).not.toHaveBeenCalled();
  });

  it("uses captured guid for save path and synthesizes Page.downloadWillBegin", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entry.pendingDownloadGuids.set(
      "https://example.com/report.pdf",
      "guid-from-cdp",
    );
    const onEvent = vi.fn();
    entry.eventListeners.add(onEvent);
    entries.set(TARGET_ID, entry);

    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    const item = makeFakeItem();
    trigger(item, entry);

    expect(item.setSavePath).toHaveBeenCalledWith("/tmp/dl/guid-from-cdp");
    expect(entry.pendingDownloadGuids.size).toBe(0);
    expect(onEvent).toHaveBeenCalledWith("Page.downloadWillBegin", {
      frameId: TARGET_ID,
      guid: "guid-from-cdp",
      suggestedFilename: "report.pdf",
      url: "https://example.com/report.pdf",
    });
  });

  describe("a local file the page may not save", () => {
    const pageAt = (entry: BrowserEntry, url: string) => {
      entry.webContents = {
        id: ++webContentsCounter,
        mainFrame: { url },
      } as unknown as WebContents;
    };

    it("tells agent-browser at once that the download was canceled", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      pageAt(entry, "file:///Users/me/site/index.html");
      entry.authorizedDownloadPath = "/tmp/dl";
      entry.pendingDownloadGuids.set("file:///etc/hosts", "guid-1");
      const onEvent = vi.fn();
      entry.eventListeners.add(onEvent);
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem({
        filename: "hosts",
        url: "file:///etc/hosts",
      });
      trigger(item, entry);

      expect(item.cancel).toHaveBeenCalledOnce();
      expect(item.setSavePath).not.toHaveBeenCalled();
      expect(entry.authorizedDownloadPath).toBeNull();
      expect(onEvent.mock.calls).toEqual([
        [
          "Page.downloadWillBegin",
          {
            frameId: TARGET_ID,
            guid: "guid-1",
            suggestedFilename: "hosts",
            url: "file:///etc/hosts",
          },
        ],
        [
          "Page.downloadProgress",
          {
            guid: "guid-1",
            receivedBytes: 0,
            state: "canceled",
            totalBytes: 0,
          },
        ],
      ]);
    });

    it("cancels the person's own click without an agent-browser event", () => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      pageAt(entry, "file:///Users/me/site/index.html");
      const onEvent = vi.fn();
      entry.eventListeners.add(onEvent);
      entries.set(TARGET_ID, entry);
      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem({
        filename: "hosts",
        url: "file:///etc/hosts",
      });
      trigger(item, entry);

      expect(item.cancel).toHaveBeenCalledOnce();
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  it("falls back to a generated UUID when no guid was captured", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entries.set(TARGET_ID, entry);

    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-0000-0000-000000000001",
    );

    const item = makeFakeItem();
    trigger(item, entry);

    expect(item.setSavePath).toHaveBeenCalledWith(
      "/tmp/dl/00000000-0000-0000-0000-000000000001",
    );
  });

  it.each([
    { expectedState: "completed" as const, state: "completed" as const },
    { expectedState: "canceled" as const, state: "interrupted" as const },
    { expectedState: "canceled" as const, state: "cancelled" as const },
  ])(
    "emits Page.downloadProgress with state=$expectedState when item finishes with $state",
    ({ expectedState, state }) => {
      const entries = new Map<BrowserTargetId, BrowserEntry>();
      const entry = makeEntry();
      entry.authorizedDownloadPath = "/tmp/dl";
      entry.pendingDownloadGuids.set("https://example.com/report.pdf", "g");
      const onEvent = vi.fn();
      entry.eventListeners.add(onEvent);
      entries.set(TARGET_ID, entry);

      const { session, trigger } = makeSession();
      routeGuestDownloads(session, lookupIn(entries));

      const item = makeFakeItem();
      trigger(item, entry);

      onEvent.mockClear();
      (item as unknown as EventEmitter).emit("done", {}, state);

      expect(onEvent).toHaveBeenCalledWith("Page.downloadProgress", {
        guid: "g",
        receivedBytes: 1024,
        state: expectedState,
        totalBytes: 1024,
      });
    },
  );

  // agent-browser authorizes ahead of each `download` and never rescinds, so
  // the authorization ends with the transfer it was for: the person's next
  // click on the same guest is theirs, not a GUID in the agent's folder.
  it("spends the agent's authorization on the one download", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entries.set(TARGET_ID, entry);
    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    const agentItem = makeFakeItem();
    trigger(agentItem, entry);
    (agentItem as unknown as EventEmitter).emit("done", {}, "completed");
    const personItem = makeFakeItem();
    trigger(personItem, entry);

    expect(entry.authorizedDownloadPath).toBeNull();
    expect(personItem.setSavePath).toHaveBeenCalledWith(
      path.join(home.downloads, "report.pdf"),
    );
  });

  it("ignores done event if entry was removed before completion", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    const onEvent = vi.fn();
    entry.eventListeners.add(onEvent);
    entries.set(TARGET_ID, entry);

    const { session, trigger } = makeSession();
    routeGuestDownloads(session, lookupIn(entries));

    const item = makeFakeItem();
    trigger(item, entry);
    onEvent.mockClear();

    entries.delete(TARGET_ID);
    (item as unknown as EventEmitter).emit("done", {}, "completed");

    expect(onEvent).not.toHaveBeenCalled();
  });
});
