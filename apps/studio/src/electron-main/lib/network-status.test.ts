import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  net: { isOnline: () => true },
  powerMonitor: { on: vi.fn() },
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

import {
  combineNetworkStatus,
  readNetworkStatusOverride,
} from "./network-status";

describe("combineNetworkStatus", () => {
  it.each([
    [true, "reachable", undefined, "online"],
    [true, "unknown", undefined, "online"],
    [true, "unreachable", undefined, "instrument-unreachable"],
    [false, "reachable", undefined, "offline"],
    [false, "unreachable", undefined, "offline"],
    [true, "reachable", "offline", "offline"],
    [false, "reachable", "instrument-unreachable", "instrument-unreachable"],
  ] as const)(
    "online %s, API %s, override %s: %s",
    (isOnline, platformApi, override, expected) => {
      expect(combineNetworkStatus({ isOnline, override, platformApi })).toBe(
        expected,
      );
    },
  );
});

describe("readNetworkStatusOverride", () => {
  it.each([
    ["offline", false, "offline"],
    ["instrument-unreachable", false, "instrument-unreachable"],
    ["offline", true, undefined],
    ["nonsense", false, undefined],
    [undefined, false, undefined],
  ] as const)("%s, packaged %s: %s", (value, isPackaged, expected) => {
    expect(readNetworkStatusOverride(value, isPackaged)).toBe(expected);
  });
});
