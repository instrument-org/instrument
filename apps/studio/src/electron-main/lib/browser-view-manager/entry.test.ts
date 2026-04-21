import type { BrowserWindow, WebContentsView } from "electron";

import { type ProjectSubdomain } from "@instrument-org/workspace/electron";
import { describe, expect, it, vi } from "vitest";

import {
  type BrowserEntry,
  createEntry,
  destroyEntry,
  handleDetach,
  subscribeEvents,
} from "./entry";

function makeEntry(targetId = "1"): BrowserEntry {
  return createEntry({
    // Stub host objects; entry helpers never touch their internals here.
    hostWindow: {} as BrowserWindow,
    subdomain: "agent-browser-test" as ProjectSubdomain,
    targetId,
    view: {} as WebContentsView,
  });
}

describe("destroyEntry", () => {
  it("drains disposers in insertion order and removes the entry", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    const order: string[] = [];
    entry.disposers.add(() => order.push("a"));
    entry.disposers.add(() => order.push("b"));
    entry.disposers.add(() => order.push("c"));
    entries.set("1", entry);

    destroyEntry(entries, "1");

    expect(order).toEqual(["a", "b", "c"]);
    expect(entry.disposers.size).toBe(0);
    expect(entries.has("1")).toBe(false);
  });

  it("continues draining if a disposer throws", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    const after = vi.fn();
    entry.disposers.add(() => {
      throw new Error("boom");
    });
    entry.disposers.add(after);
    entries.set("1", entry);

    expect(() => {
      destroyEntry(entries, "1");
    }).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(entries.has("1")).toBe(false);
  });

  it("does not re-run disposers if called twice", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    const dispose = vi.fn();
    entry.disposers.add(dispose);
    entries.set("1", entry);

    destroyEntry(entries, "1");
    destroyEntry(entries, "1");

    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("handleDetach", () => {
  it("notifies detach listeners then clears event/detach listeners and disposers", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    const order: string[] = [];
    const onDetach = vi.fn(() => order.push("detach"));
    const onEvent = vi.fn();
    entry.detachListeners.add(onDetach);
    entry.eventListeners.add(onEvent);
    entry.disposers.add(() => order.push("disposer"));
    entries.set("1", entry);

    handleDetach(entries, "1");

    expect(onDetach).toHaveBeenCalledOnce();
    expect(order).toEqual(["detach", "disposer"]);
    expect(entry.detachListeners.size).toBe(0);
    expect(entry.eventListeners.size).toBe(0);
    expect(entry.disposers.size).toBe(0);
    expect(entries.has("1")).toBe(false);
  });

  it("does not double-fire when called after destroyEntry", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    const onDetach = vi.fn();
    entry.detachListeners.add(onDetach);
    entries.set("1", entry);

    destroyEntry(entries, "1");
    handleDetach(entries, "1");

    expect(onDetach).not.toHaveBeenCalled();
  });
});

describe("subscribeEvents", () => {
  it("calls onDetach immediately and returns a no-op unsubscribe when target missing", () => {
    const entries = new Map<string, BrowserEntry>();
    const onDetach = vi.fn();
    const onEvent = vi.fn();
    const ensureDebuggerAttached = vi.fn();

    const unsubscribe = subscribeEvents({
      ensureDebuggerAttached,
      entries,
      onDetach,
      onEvent,
      targetId: "missing",
    });

    expect(onDetach).toHaveBeenCalledOnce();
    expect(ensureDebuggerAttached).not.toHaveBeenCalled();
    expect(() => {
      unsubscribe();
    }).not.toThrow();
  });

  it("registers listeners, ensures the debugger is attached, and unsubscribes cleanly", () => {
    const entries = new Map<string, BrowserEntry>();
    const entry = makeEntry();
    entries.set("1", entry);
    const ensureDebuggerAttached = vi.fn();
    const onDetach = vi.fn();
    const onEvent = vi.fn();

    const unsubscribe = subscribeEvents({
      ensureDebuggerAttached,
      entries,
      onDetach,
      onEvent,
      targetId: "1",
    });

    expect(ensureDebuggerAttached).toHaveBeenCalledWith(entry);
    expect(entry.eventListeners.has(onEvent)).toBe(true);
    expect(entry.detachListeners.has(onDetach)).toBe(true);

    unsubscribe();

    expect(entry.eventListeners.has(onEvent)).toBe(false);
    expect(entry.detachListeners.has(onDetach)).toBe(false);
  });
});
