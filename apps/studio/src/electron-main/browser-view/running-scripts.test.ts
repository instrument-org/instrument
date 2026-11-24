import { noop } from "radashi";
import { describe, expect, it } from "vitest";

import { keepRunningScript, runningScript } from "./running-scripts";

const keep = (targetId = "tab_a") =>
  keepRunningScript({
    answer: new Promise(noop),
    startedAt: 0,
    targetId,
  });

describe("kept running scripts", () => {
  it("answers only the tab a script runs in", () => {
    const script = keep("tab_a");

    expect(runningScript(script.id, "tab_b")).toBeUndefined();
    expect(runningScript(script.id, "tab_a")).toBe(script);
  });

  it("lets go of the one asked after longest ago once too many are kept", () => {
    const first = keep();
    const second = keep();
    const later = Array.from({ length: 14 }, () => keep());

    // Asked after, so the second is now the one left alone longest.
    expect(runningScript(first.id, "tab_a")).toBe(first);
    keep();

    expect(runningScript(second.id, "tab_a")).toBeUndefined();
    expect(runningScript(first.id, "tab_a")).toBe(first);
    for (const script of later) {
      expect(runningScript(script.id, "tab_a")).toBe(script);
    }
  });
});
