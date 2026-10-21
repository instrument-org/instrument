import { describe, expect, it } from "vitest";

import { holdDictation, isDictationInProgress } from "./dictation-in-progress";

describe("holdDictation", () => {
  it("counts a recording until its caller lets go", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const held = [holdDictation(first.signal), holdDictation(second.signal)];
    expect(isDictationInProgress()).toBe(true);

    first.abort();
    await held[0];
    expect(isDictationInProgress()).toBe(true);

    second.abort();
    await held[1];
    expect(isDictationInProgress()).toBe(false);
  });

  it("never counts a call that was already let go", async () => {
    const gone = new AbortController();
    gone.abort();
    await holdDictation(gone.signal);
    expect(isDictationInProgress()).toBe(false);
  });
});
