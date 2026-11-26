import { afterEach, expect, it, vi } from "vitest";

import {
  awakeMsSince,
  awakeNow,
  heldMs,
  measureHoldsWith,
} from "./process-holds";

afterEach(() => {
  measureHoldsWith(() => 0);
  vi.restoreAllMocks();
});

it("reads no holds until something measures them", () => {
  expect(heldMs()).toBe(0);
});

it("leaves a hold out of a duration measured across it", () => {
  let held = 0;
  measureHoldsWith(() => held);
  const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
  const started = awakeNow();
  now.mockReturnValue(1_000 + 217_159);
  held = 215_578;

  expect(awakeMsSince(started)).toBe(1_581);
});

it("never reads a duration below zero when a hold is counted after it began", () => {
  let held = 0;
  measureHoldsWith(() => held);
  vi.spyOn(performance, "now").mockReturnValue(600_000);
  const started = awakeNow();
  held = 600_000;

  expect(awakeMsSince(started)).toBe(0);
});
