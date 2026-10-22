import { describe, expect, it } from "vitest";

import { createRepeatLimiter } from "./repeat-limiter";

describe("createRepeatLimiter", () => {
  it("lets a key through up to the limit per interval and counts the rest", () => {
    const take = createRepeatLimiter({ intervalMs: 1000, limit: 2 });

    const decisions = Array.from({ length: 5 }, () => take("a", 0).allowed);
    expect(decisions).toEqual([true, true, false, false, false]);

    expect(take("a", 1000)).toEqual({ allowed: true, suppressed: 3 });
    expect(take("a", 1001)).toEqual({ allowed: true, suppressed: 0 });
  });

  it("limits each key on its own", () => {
    const take = createRepeatLimiter({ intervalMs: 1000, limit: 1 });

    expect(take("a", 0).allowed).toBe(true);
    expect(take("a", 0).allowed).toBe(false);
    expect(take("b", 0).allowed).toBe(true);
  });

  it("forgets the oldest key past its bound", () => {
    const take = createRepeatLimiter({
      intervalMs: 1000,
      limit: 1,
      maxKeys: 2,
    });

    take("a", 0);
    take("b", 0);
    take("c", 0);

    // "a" was forgotten, so it starts over rather than being held back.
    expect(take("a", 0).allowed).toBe(true);
    expect(take("c", 0).allowed).toBe(false);
  });
});
