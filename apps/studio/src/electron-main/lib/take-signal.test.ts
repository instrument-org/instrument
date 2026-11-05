import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { keepTrapFatal, takeSignal } from "./take-signal";

/**
 * Stands in for `process`, whose signal handle Node opens on a signal's first
 * listener and closes when its last one goes (`startListeningIfSignal`).
 */
function fakeProcess() {
  const target = new EventEmitter();
  const handles: string[] = [];
  target.on("newListener", (event: string) => {
    if (event.startsWith("SIG") && target.listenerCount(event) === 0) {
      handles.push(`open ${event}`);
    }
  });
  target.on("removeListener", (event: string) => {
    if (event.startsWith("SIG") && target.listenerCount(event) === 0) {
      handles.push(`close ${event}`);
    }
  });
  return {
    handles,
    // The fake covers the three methods takeSignal calls.
    target: target as unknown as NodeJS.Process,
    emit: (signal: string) => target.emit(signal, signal),
  };
}

describe("takeSignal", () => {
  it("opens a new handle when a listener got there first", () => {
    const fake = fakeProcess();
    fake.target.once("SIGTERM", () => {});
    takeSignal(fake.target, "SIGTERM", () => {});

    expect(fake.handles).toEqual([
      "open SIGTERM",
      "close SIGTERM",
      "open SIGTERM",
    ]);
  });

  it("keeps an earlier listener first, and once only once", () => {
    const fake = fakeProcess();
    const calls: string[] = [];
    fake.target.once("SIGTERM", () => calls.push("earlier"));
    takeSignal(fake.target, "SIGTERM", () => calls.push("taken"));

    fake.emit("SIGTERM");
    fake.emit("SIGTERM");

    expect(calls).toEqual(["earlier", "taken", "taken"]);
  });

  it("opens one handle when nothing listened yet", () => {
    const fake = fakeProcess();
    takeSignal(fake.target, "SIGINT", () => {});

    expect(fake.handles).toEqual(["open SIGINT"]);
  });
});

describe("keepTrapFatal", () => {
  it("takes off a listener already there and any added later, closing the handle each time", async () => {
    const fake = fakeProcess();
    fake.target.on("SIGTRAP", () => {});
    keepTrapFatal(fake.target);
    expect(fake.target.listenerCount("SIGTRAP")).toBe(0);

    fake.target.on("SIGTRAP", () => {});
    await Promise.resolve();

    expect(fake.target.listenerCount("SIGTRAP")).toBe(0);
    expect(fake.handles).toEqual([
      "open SIGTRAP",
      "close SIGTRAP",
      "open SIGTRAP",
      "close SIGTRAP",
    ]);
  });

  it("leaves every other signal's listeners", async () => {
    const fake = fakeProcess();
    keepTrapFatal(fake.target);
    fake.target.on("SIGTERM", () => {});
    await Promise.resolve();

    expect(fake.target.listenerCount("SIGTERM")).toBe(1);
  });
});
