import type { BrowserWindow, Session, WebContentsView } from "electron";

import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  applyDownloadBehavior,
  attachDownloadHandler,
  captureDownloadWillBeginGuid,
} from "./downloads";
import { type BrowserEntry, createEntry } from "./entry";

interface FakeItem extends EventEmitter {
  cancel: ReturnType<typeof vi.fn>;
  getFilename: () => string;
  getReceivedBytes: () => number;
  getTotalBytes: () => number;
  getURL: () => string;
  setSavePath: ReturnType<typeof vi.fn>;
}

function makeEntry(targetId = "1"): BrowserEntry {
  return createEntry({
    hostWindow: {} as BrowserWindow,
    subdomain: "agent-browser-test" as ProjectSubdomain,
    targetId,
    view: {} as WebContentsView,
  });
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
function makeSession() {
  const handlers: Record<string, (event: unknown, item: FakeItem) => void> = {};
  const session = {
    on(eventName: string, cb: (event: unknown, item: FakeItem) => void) {
      handlers[eventName] = cb;
      return session;
    },
  } as unknown as Session;
  function trigger(item: FakeItem) {
    const cb = handlers["will-download"];
    if (!cb) {
      throw new Error("will-download not registered");
    }
    cb({}, item);
  }
  return { session, trigger };
}

describe("attachDownloadHandler", () => {
  it("cancels downloads when no path is authorized", () => {
    const entries = new Map<string, BrowserEntry>();
    entries.set("1", makeEntry());
    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session, targetId: "1" });

    const item = makeFakeItem();
    trigger(item);

    expect(item.cancel).toHaveBeenCalledOnce();
    expect(item.setSavePath).not.toHaveBeenCalled();
  });

  it("uses captured guid for save path and synthesizes Page.downloadWillBegin", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entry.pendingDownloadGuids.set(
      "https://example.com/report.pdf",
      "guid-from-cdp",
    );
    const onEvent = vi.fn();
    entry.eventListeners.add(onEvent);
    entries.set("1", entry);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session, targetId: "1" });

    const item = makeFakeItem();
    trigger(item);

    expect(item.setSavePath).toHaveBeenCalledWith("/tmp/dl/guid-from-cdp");
    expect(entry.pendingDownloadGuids.size).toBe(0);
    expect(onEvent).toHaveBeenCalledWith("Page.downloadWillBegin", {
      frameId: "1",
      guid: "guid-from-cdp",
      suggestedFilename: "report.pdf",
      url: "https://example.com/report.pdf",
    });
  });

  it("falls back to a generated UUID when no guid was captured", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    entries.set("1", entry);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session, targetId: "1" });

    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-0000-0000-000000000001" as `${string}-${string}-${string}-${string}-${string}`,
    );

    const item = makeFakeItem();
    trigger(item);

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
      const entries = new Map<string, BrowserEntry>();
      const entry = makeEntry();
      entry.authorizedDownloadPath = "/tmp/dl";
      entry.pendingDownloadGuids.set("https://example.com/report.pdf", "g");
      const onEvent = vi.fn();
      entry.eventListeners.add(onEvent);
      entries.set("1", entry);

      const { session, trigger } = makeSession();
      attachDownloadHandler({ entries, session, targetId: "1" });

      const item = makeFakeItem();
      trigger(item);

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
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    entry.authorizedDownloadPath = "/tmp/dl";
    const onEvent = vi.fn();
    entry.eventListeners.add(onEvent);
    entries.set("1", entry);

    const { session, trigger } = makeSession();
    attachDownloadHandler({ entries, session, targetId: "1" });

    const item = makeFakeItem();
    trigger(item);
    onEvent.mockClear();

    entries.delete("1");
    (item as unknown as EventEmitter).emit("done", {}, "completed");

    expect(onEvent).not.toHaveBeenCalled();
  });
});
