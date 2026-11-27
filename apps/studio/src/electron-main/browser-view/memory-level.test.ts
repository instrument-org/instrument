import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  availableMemoryLevel,
  CRITICAL_AVAILABLE_BYTES,
  LOW_AVAILABLE_BYTES,
  macMemoryLevel,
} from "./memory-level";

describe("macMemoryLevel", () => {
  it.each([
    [1, "normal"],
    [2, "low"],
    [4, "critical"],
    [Number.NaN, "normal"],
  ])("kernel level %s is %s", (level, expected) => {
    expect(macMemoryLevel(level)).toBe(expected);
  });
});

describe("availableMemoryLevel", () => {
  it.each([
    [8 * 1024 ** 3, "normal"],
    [LOW_AVAILABLE_BYTES, "normal"],
    [LOW_AVAILABLE_BYTES - 1, "low"],
    [CRITICAL_AVAILABLE_BYTES, "low"],
    [CRITICAL_AVAILABLE_BYTES - 1, "critical"],
    [0, "normal"],
  ])("%s bytes available is %s", (bytes, expected) => {
    expect(availableMemoryLevel(bytes)).toBe(expected);
  });
});
