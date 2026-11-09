import { describe, expect, it, vi } from "vitest";

import { createAlarmGate } from "./alarms";

describe("the alarm gate", () => {
  it("lets a key warn once an hour", () => {
    let at = 0;
    const gate = createAlarmGate({ now: () => at });
    const warn = vi.fn();
    expect(gate.raise("a", () => "first", warn)).toBe(true);
    at = 59 * 60_000;
    expect(gate.raise("a", () => "again", warn)).toBe(false);
    expect(gate.raise("b", () => "other key", warn)).toBe(true);
    at = 60 * 60_000;
    expect(gate.raise("a", () => "an hour on", warn)).toBe(true);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "first",
      "other key",
      "an hour on",
    ]);
  });

  it("holds back what passes the launch's share, saying so once", () => {
    let at = 0;
    const gate = createAlarmGate({ now: () => at, perLaunch: 2 });
    const warn = vi.fn();
    gate.raise("a", () => "a", warn);
    gate.raise("b", () => "b", warn);
    gate.raise("c", () => "c", warn);
    at = 2 * 60 * 60_000;
    gate.raise("a", () => "a later", warn);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "a",
      "b",
      "Alarms: 2 logged this launch; the rest are held back until the next one",
    ]);
  });

  it("builds no line for a warning it holds back", () => {
    const gate = createAlarmGate({ now: () => 0 });
    const line = vi.fn(() => "built");
    gate.raise("a", line, () => {});
    gate.raise("a", line, () => {});
    expect(line).toHaveBeenCalledTimes(1);
  });

  it("remembers a bounded number of keys", () => {
    const gate = createAlarmGate({ maxKeys: 2, now: () => 0, perLaunch: 100 });
    const warn = vi.fn();
    gate.raise("a", () => "a", warn);
    gate.raise("b", () => "b", warn);
    expect(gate.raise("c", () => "c", warn)).toBe(false);
  });
});
