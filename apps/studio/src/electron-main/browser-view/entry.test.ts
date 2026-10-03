import type {
  AbsolutePath,
  BrowserTargetId,
} from "@instrument-org/workspace/electron";

import {
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import {
  advanceEntry,
  type BrowserEntry,
  createEntry,
  destroyEntry,
  handleDetach,
  hasGuest,
  nextEntryPhase,
  subscribeEvents,
} from "./entry";

const SUBDOMAIN = TaskIdSchema.parse("agent-browser-test");
const SESSION_ID = StoreId.newSessionId();
const TARGET_ID = encodeBrowserTargetId(SUBDOMAIN, SESSION_ID);

function makeEntry(targetId: BrowserTargetId = TARGET_ID): BrowserEntry {
  return createEntry({
    id: SUBDOMAIN,
    partitionDir: "/tmp/partition" as AbsolutePath,
    sessionId: SESSION_ID,
    targetId,
  });
}

describe("destroyEntry", () => {
  it("drains disposers in insertion order and removes the entry", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    const order: string[] = [];
    entry.disposers.add(() => order.push("a"));
    entry.disposers.add(() => order.push("b"));
    entry.disposers.add(() => order.push("c"));
    entries.set(TARGET_ID, entry);

    destroyEntry(entries, TARGET_ID);

    expect(order).toEqual(["a", "b", "c"]);
    expect(entry.disposers.size).toBe(0);
    expect(entries.has(TARGET_ID)).toBe(false);
  });

  it("continues draining if a disposer throws", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    const after = vi.fn();
    entry.disposers.add(() => {
      throw new Error("boom");
    });
    entry.disposers.add(after);
    entries.set(TARGET_ID, entry);

    expect(() => {
      destroyEntry(entries, TARGET_ID);
    }).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(entries.has(TARGET_ID)).toBe(false);
  });

  it("does not re-run disposers if called twice", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    const dispose = vi.fn();
    entry.disposers.add(dispose);
    entries.set(TARGET_ID, entry);

    destroyEntry(entries, TARGET_ID);
    destroyEntry(entries, TARGET_ID);

    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("handleDetach", () => {
  it("notifies detach listeners then clears event/detach listeners and disposers", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    const order: string[] = [];
    const onDetach = vi.fn(() => order.push("detach"));
    const onEvent = vi.fn();
    entry.detachListeners.add(onDetach);
    entry.eventListeners.add(onEvent);
    entry.disposers.add(() => order.push("disposer"));
    entries.set(TARGET_ID, entry);

    handleDetach(entries, TARGET_ID);

    expect(onDetach).toHaveBeenCalledOnce();
    expect(order).toEqual(["detach", "disposer"]);
    expect(entry.detachListeners.size).toBe(0);
    expect(entry.eventListeners.size).toBe(0);
    expect(entry.disposers.size).toBe(0);
    expect(entries.has(TARGET_ID)).toBe(false);
  });

  it("does not double-fire when called after destroyEntry", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    const onDetach = vi.fn();
    entry.detachListeners.add(onDetach);
    entries.set(TARGET_ID, entry);

    destroyEntry(entries, TARGET_ID);
    handleDetach(entries, TARGET_ID);

    expect(onDetach).not.toHaveBeenCalled();
  });
});

describe("subscribeEvents", () => {
  it("calls onDetach immediately and returns a no-op unsubscribe when target missing", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const onDetach = vi.fn();
    const onEvent = vi.fn();
    const ensureDebuggerAttached = vi.fn();

    const unsubscribe = subscribeEvents({
      ensureDebuggerAttached,
      entries,
      onDetach,
      onEvent,
      targetId: "missing/x" as BrowserTargetId,
    });

    expect(onDetach).toHaveBeenCalledOnce();
    expect(ensureDebuggerAttached).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });

  it("registers listeners, ensures the debugger is attached, and unsubscribes cleanly", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entries.set(TARGET_ID, entry);
    const ensureDebuggerAttached = vi.fn();
    const onDetach = vi.fn();
    const onEvent = vi.fn();

    const unsubscribe = subscribeEvents({
      ensureDebuggerAttached,
      entries,
      onDetach,
      onEvent,
      targetId: TARGET_ID,
    });

    expect(ensureDebuggerAttached).toHaveBeenCalledWith(entry);
    expect(entry.eventListeners.has(onEvent)).toBe(true);
    expect(entry.detachListeners.has(onDetach)).toBe(true);

    unsubscribe();

    expect(entry.eventListeners.has(onEvent)).toBe(false);
    expect(entry.detachListeners.has(onDetach)).toBe(false);
  });
});

describe("entry phase", () => {
  it.each([
    ["pending", "willAttach", "accepted"],
    ["pending", "didAttach", undefined],
    ["pending", "attachTimedOut", "gone"],
    ["accepted", "willAttach", "accepted"],
    ["accepted", "didAttach", "bound"],
    ["accepted", "attachTimedOut", "gone"],
    ["bound", "willAttach", undefined],
    ["bound", "didAttach", undefined],
    ["bound", "loadSettled", "live"],
    ["bound", "attachTimedOut", undefined],
    ["live", "loadSettled", undefined],
    ["live", "willAttach", undefined],
    ["live", "removed", "gone"],
    ["gone", "didAttach", undefined],
    ["gone", "removed", undefined],
  ] as const)("%s on %s -> %s", (phase, event, expected) => {
    expect(nextEntryPhase(phase, event)).toBe(expected);
  });

  it("follows Electron's order from createTarget to a settled first load", () => {
    const entry = makeEntry();
    const steps = (
      ["willAttach", "didAttach", "loadSettled", "loadSettled"] as const
    ).map((event) => [advanceEntry(entry, event), entry.phase]);
    expect(steps).toEqual([
      [true, "accepted"],
      [true, "bound"],
      [true, "live"],
      [false, "live"],
    ]);
  });

  it("refuses a guest handed over after the entry was removed", () => {
    const entries = new Map<BrowserTargetId, BrowserEntry>();
    const entry = makeEntry();
    entries.set(TARGET_ID, entry);
    advanceEntry(entry, "willAttach");
    destroyEntry(entries, TARGET_ID);

    expect(entry.phase).toBe("gone");
    expect(advanceEntry(entry, "didAttach")).toBe(false);
    // A target created again under the same id starts over rather than taking
    // the guest mounted for the one before it.
    expect(makeEntry().phase).toBe("pending");
  });

  it("binds the first of two guests mounted for one target and ignores the second", () => {
    const entry = makeEntry();
    advanceEntry(entry, "willAttach");
    advanceEntry(entry, "willAttach");

    expect(advanceEntry(entry, "didAttach")).toBe(true);
    expect(advanceEntry(entry, "didAttach")).toBe(false);
    expect(hasGuest(entry)).toBe(true);
  });
});
