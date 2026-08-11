import { describe, expect, it } from "vitest";

import { createWriteQueue } from "./create-write-queue";

// Resolves only when told to, so a test can hold one job open and prove the
// next is waiting rather than racing it with a timer.
function deferred() {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle?.() };
}

describe("createWriteQueue", () => {
  it("holds work for the same key until the one before it finishes", async () => {
    const enqueue = createWriteQueue();
    const first = deferred();
    const order: string[] = [];

    const a = enqueue("task", async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = enqueue("task", () => {
      order.push("b:start");
      return Promise.resolve();
    });

    // b must not have begun while a is still open.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);

    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("runs different keys independently", async () => {
    const enqueue = createWriteQueue();
    const held = deferred();
    const order: string[] = [];

    const blocked = enqueue("one", async () => {
      await held.promise;
      order.push("one");
    });
    await enqueue("two", () => {
      order.push("two");
      return Promise.resolve();
    });

    // The second key finished while the first is still held open.
    expect(order).toEqual(["two"]);

    held.resolve();
    await blocked;
    expect(order).toEqual(["two", "one"]);
  });

  it("keeps the queue moving after work rejects, and still reports it", async () => {
    const enqueue = createWriteQueue();

    const failed = enqueue("task", () =>
      Promise.reject(new Error("write failed")),
    );
    const after = enqueue("task", () => Promise.resolve("ran anyway"));

    await expect(failed).rejects.toThrow("write failed");
    await expect(after).resolves.toBe("ran anyway");
  });

  it("returns each caller its own result", async () => {
    const enqueue = createWriteQueue();

    const results = await Promise.all([
      enqueue("task", () => Promise.resolve(1)),
      enqueue("task", () => Promise.resolve(2)),
      enqueue("other", () => Promise.resolve(3)),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });
});
