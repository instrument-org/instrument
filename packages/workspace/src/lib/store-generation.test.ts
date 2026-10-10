import { describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import {
  bumpStoreGeneration,
  cacheByStoreGeneration,
} from "./store-generation";

const taskId = ChatIdSchema.parse("2026-10-01-store-generation");
const otherTaskId = ChatIdSchema.parse("2026-10-01-another-task");

describe("cacheByStoreGeneration", () => {
  it("keeps a value until its task's store is written", async () => {
    const cache = cacheByStoreGeneration<number>();
    let computed = 0;
    const read = () => cache(taskId, () => Promise.resolve(++computed));

    expect(await read()).toBe(1);
    expect(await read()).toBe(1);
    bumpStoreGeneration(otherTaskId);
    expect(await read()).toBe(1);
    bumpStoreGeneration(taskId);
    expect(await read()).toBe(2);
  });

  it("does not keep a value whose store was written while it was computed", async () => {
    const cache = cacheByStoreGeneration<number>();
    let computed = 0;
    const first = cache(taskId, () => {
      computed += 1;
      bumpStoreGeneration(taskId);
      return Promise.resolve(computed);
    });
    expect(await first).toBe(1);
    expect(await cache(taskId, () => Promise.resolve(++computed))).toBe(2);
  });

  it("forgets a value that failed", async () => {
    const cache = cacheByStoreGeneration<number>();
    await expect(
      cache(taskId, () => Promise.reject(new Error("unreadable"))),
    ).rejects.toThrow("unreadable");
    expect(await cache(taskId, () => Promise.resolve(3))).toBe(3);
  });
});
