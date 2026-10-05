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

import { createEntry } from "./entry";
import { createGuestRegistry } from "./guest-registry";

const { createdListeners, liveFrames } = vi.hoisted(() => ({
  createdListeners: [] as ((event: unknown, contents: unknown) => void)[],
  liveFrames: new Set<string>(),
}));

vi.mock("electron", () => ({
  app: {
    on: (
      _name: "web-contents-created",
      listener: (event: unknown, contents: unknown) => void,
    ) => {
      createdListeners.push(listener);
    },
  },
  webFrameMain: {
    fromId: (processId: number, routingId: number) =>
      liveFrames.has(`${processId}:${routingId}`) ? {} : undefined,
  },
}));

const TASK = TaskIdSchema.parse("registry-test");

let nextId = 1;

/** A web contents as the registry hears one: its id, type, session and events. */
function contentsIn(session: object, type: "webview" | "window" = "webview") {
  // Electron's WebContents is a Node EventEmitter.
  return Object.assign(new EventEmitter(), {
    getType: () => type,
    id: nextId++,
    session,
  });
}

/** A frame committing a document, as `did-frame-navigate` reports one. */
function commit(contents: EventEmitter, routingId: number, url: string) {
  liveFrames.add(`4:${routingId}`);
  contents.emit("did-frame-navigate", {}, url, -1, "", false, 4, routingId);
}

function entryFor(targetId: BrowserTargetId = randomTarget()) {
  return createEntry({
    id: TASK,
    partitionDir: "/tmp/profile" as AbsolutePath,
    sessionId: StoreId.newSessionId(),
    targetId,
  });
}

function randomTarget() {
  return encodeBrowserTargetId(TASK, StoreId.newSessionId());
}

describe("createGuestRegistry", () => {
  it("records a frame's document by what it committed, not where it moved its address", () => {
    const registry = createGuestRegistry();
    const contents = contentsIn({});
    registry.track(contents as unknown as WebContents, "webview");

    commit(contents, 1, "file:///Users/casey/site/index.html");
    contents.emit("did-navigate-in-page", {}, "file:///etc/z.html", true, 4, 1);

    expect(
      registry.documentOf(contents.id, { processId: 4, routingId: 1 }),
    ).toBe("file:///Users/casey/site/index.html");
  });

  it("forgets a frame that no longer exists", () => {
    const registry = createGuestRegistry();
    const contents = contentsIn({});
    registry.track(contents as unknown as WebContents, "webview");
    commit(contents, 2, "https://example.com/ad");
    liveFrames.delete("4:2");
    commit(contents, 3, "https://example.com/");

    expect(
      registry.documentOf(contents.id, { processId: 4, routingId: 2 }),
    ).toBeUndefined();
  });

  it("answers for a contents only once one names it", () => {
    const registry = createGuestRegistry();
    expect(
      registry.documentOf(undefined, { processId: 4, routingId: 1 }),
    ).toBeUndefined();
    expect(registry.entryOf(999)).toBeUndefined();
  });

  it("finds the tab's entry a guest is bound to, until the guest goes", () => {
    const registry = createGuestRegistry();
    const contents = contentsIn({});
    registry.track(contents as unknown as WebContents, "webview");
    const entry = entryFor();

    registry.bind(contents.id, entry);
    expect(registry.entryOf(contents.id)).toBe(entry);

    contents.emit("destroyed");
    expect(registry.get(contents.id)).toBeUndefined();
    expect(registry.entryOf(contents.id)).toBeUndefined();
  });

  it("exempts a task's own guests from ad blocking, and only while it asks", () => {
    const registry = createGuestRegistry();
    const contents = contentsIn({});
    registry.track(contents as unknown as WebContents, "webview");
    registry.bind(contents.id, entryFor());

    expect(registry.setAdBlocking(TASK, undefined)).toBe(true);
    expect(registry.setAdBlocking(TASK, false)).toBe(false);
    expect(registry.isAdBlockExempt(contents.id)).toBe(true);
    expect(registry.setAdBlocking(TASK, true)).toBe(true);
    expect(registry.isAdBlockExempt(contents.id)).toBe(false);
  });

  it("never exempts a contents no tab owns", () => {
    const registry = createGuestRegistry();
    const popup = contentsIn({}, "window");
    registry.track(popup as unknown as WebContents, "popup");
    registry.setAdBlocking(TASK, false);

    expect(registry.isAdBlockExempt(popup.id)).toBe(false);
  });

  it("records each contents a watched session makes, in the role it is given", () => {
    const registry = createGuestRegistry();
    const watched = {} as Session;
    const tracked: string[] = [];
    registry.watchSession(
      watched,
      (contents) => (contents.getType() === "webview" ? "webview" : "popup"),
      (record) => {
        tracked.push(record.role);
      },
    );
    const guest = contentsIn(watched);
    const popup = contentsIn(watched, "window");
    const elsewhere = contentsIn({});

    for (const contents of [guest, popup, elsewhere]) {
      for (const listener of createdListeners) {
        listener({}, contents);
      }
    }

    expect(tracked).toEqual(["webview", "popup"]);
    expect(registry.get(guest.id)?.role).toBe("webview");
    expect(registry.get(popup.id)?.role).toBe("popup");
    expect(registry.get(elsewhere.id)).toBeUndefined();
  });
});
