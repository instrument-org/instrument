import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";
import type { Session, WebContents } from "electron";

import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/electron";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  applyDownloadBehavior,
  attachDownloadHandler,
  captureDownloadWillBeginGuid,
} from "./downloads";
import { type BrowserEntry, createEntry } from "./entry";

const SUBDOMAIN = TaskIdSchema.parse("agent-browser-test");
const SESSION_ID = StoreId.newSessionId();
const TARGET_ID = encodeBrowserTargetId(SUBDOMAIN, SESSION_ID);

interface FakeItem extends EventEmitter {
  cancel: ReturnType<typeof vi.fn>;
  getFilename: () => string;
  getReceivedBytes: () => number;
  getTotalBytes: () => number;
  getURL: () => string;
  setSavePath: ReturnType<typeof vi.fn>;
}

let webContentsCounter = 0;

// An entry with its guest bound, the state every entry is in once a download
// can reach it. Only the id matters: the handler attributes a download to a
// guest by it.
function makeEntry(targetId: BrowserTargetId = TARGET_ID): BrowserEntry {
  const entry = createEntry({
    id: SUBDOMAIN,
    partitionDir: "/tmp/partition" as AbsolutePath,
    sessionId: SESSION_ID,
    targetId,
  });
  entry.webContents = { id: ++webContentsCounter } as WebContents;
  return entry;
}

function makeFakeItem({
  filename = "report.pdf",
  url = "https://example.com/report.pdf",
}: { filename?: string; url?: string } = {}): FakeItem {
  // eslint-disable-next-line unicorn/prefer-event-target
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    cancel: vi.fn(),
    getFilename: () => filename,
    getReceivedBytes: () => 1024,
    getTotalBytes: () => 1024,
    getURL: () => url,
    setSavePath: vi.fn(),
  });
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
// Every listener runs on every event, as on a real Session: a second copy of
// the handler is a second vote on every download, which is the failure the
// per-session registration exists to rule out.
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
  return {
    listenerCount: () => listeners["will-download"]?.length ?? 0,
    session,
    trigger,
  };
}

describe("attachDownloadHandler", () => {
  it("cancels downloads when no path is authorized", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entries.set(TARGET_ID, entry);
    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session });

    const item = makeFakeItem();
    trigger(item, entry);

    expect(item.cancel).toHaveBeenCalledOnce();
    expect(item.setSavePath).not.toHaveBeenCalled();
  });

  it("registers one listener per session however many guests bind to it", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const { listenerCount, session } = makeSession();

    attachDownloadHandler({ entries, session });
    attachDownloadHandler({ entries, session });
    attachDownloadHandler({ entries, session });

    expect(listenerCount()).toBe(1);
  });

  it("routes a download by the guest that started it when several share the session", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const authorized = makeEntry();
    authorized.authorizedDownloadPath = "/tmp/dl";
    const authorizedEvents = vi.fn();
    authorized.eventListeners.add(authorizedEvents);
    entries.set(TARGET_ID, authorized);

    const otherTargetId = encodeBrowserTargetId(
      SUBDOMAIN,
      StoreId.newSessionId(),
    );
    const other = makeEntry(otherTargetId);
    const otherEvents = vi.fn();
    other.eventListeners.add(otherEvents);
    entries.set(otherTargetId, other);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session });
    attachDownloadHandler({ entries, session });

    const fromAuthorized = makeFakeItem();
    trigger(fromAuthorized, authorized);
    expect(fromAuthorized.cancel).not.toHaveBeenCalled();
    expect(fromAuthorized.setSavePath).toHaveBeenCalledOnce();
    expect(authorizedEvents).toHaveBeenCalledWith(
      "Page.downloadWillBegin",
      expect.objectContaining({ frameId: TARGET_ID }),
    );
    expect(otherEvents).not.toHaveBeenCalled();

    const fromOther = makeFakeItem();
    trigger(fromOther, other);
    expect(fromOther.cancel).toHaveBeenCalledOnce();
    expect(fromOther.setSavePath).not.toHaveBeenCalled();
  });

  it("cancels a download from a guest whose entry is gone", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const live = makeEntry();
    live.authorizedDownloadPath = "/tmp/dl";
    entries.set(TARGET_ID, live);
    const gone = makeEntry(
      encodeBrowserTargetId(SUBDOMAIN, StoreId.newSessionId()),
    );

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session });

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
    attachDownloadHandler({ entries, session });

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

  it("falls back to a generated UUID when no guid was captured", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entries.set(TARGET_ID, entry);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session });

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
      attachDownloadHandler({ entries, session });

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

  it("ignores done event if entry was removed before completion", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    const onEvent = vi.fn();
    entry.eventListeners.add(onEvent);
    entries.set(TARGET_ID, entry);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session });

    const item = makeFakeItem();
    trigger(item, entry);
    onEvent.mockClear();

    entries.delete(TARGET_ID);
    (item as unknown as EventEmitter).emit("done", {}, "completed");

    expect(onEvent).not.toHaveBeenCalled();
  });
});
