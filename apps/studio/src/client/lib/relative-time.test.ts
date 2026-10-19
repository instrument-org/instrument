import { describe, expect, it } from "vitest";

import {
  formatRelativeTime,
  RELATIVE_TIME_MAX_AGE_MS,
  relativeTickMs,
} from "./relative-time";

// Local rather than UTC: the absolute renderings below are calendar days in the
// reader's zone, so a UTC anchor would land on a different day for some of them.
const NOW = new Date("2026-08-06T15:30:00").getTime();

const ago = (ms: number) => new Date(NOW - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it.each([
    ["seconds", 5 * SECOND, "< 1 minute ago"],
    ["a minute", MINUTE, "1 minute ago"],
    ["minutes", 12 * MINUTE, "12 minutes ago"],
    ["an hour", HOUR, "1 hour ago"],
    ["hours", 5 * HOUR, "5 hours ago"],
    ["a day", DAY, "1 day ago"],
    ["days", 3 * DAY, "3 days ago"],
  ])("renders %s as a distance", (_label, ageMs, expected) => {
    expect(formatRelativeTime(ago(ageMs), NOW)).toBe(expected);
  });

  it("drops date-fns' hedging and its long sub-minute phrase", () => {
    expect(formatRelativeTime(ago(30 * SECOND), NOW)).not.toContain(
      "less than",
    );
    expect(formatRelativeTime(ago(70 * MINUTE), NOW)).not.toContain("about");
  });

  it("switches to the date once a distance stops informing", () => {
    expect(formatRelativeTime(ago(RELATIVE_TIME_MAX_AGE_MS), NOW)).toBe(
      "Jul 30",
    );
  });

  it("keeps the year on a date from another one", () => {
    expect(formatRelativeTime(new Date("2019-11-03T09:00:00"), NOW)).toBe(
      "Nov 3, 2019",
    );
  });

  it("reads a future timestamp forward rather than as an age", () => {
    expect(formatRelativeTime(new Date(NOW + 5 * MINUTE), NOW)).toBe(
      "in 5 minutes",
    );
  });
});

describe("relativeTickMs", () => {
  it.each([
    ["sub-minute", 5 * SECOND, 5 * SECOND],
    ["minute scale", 12 * MINUTE, MINUTE],
    ["hour scale", 5 * HOUR, 5 * MINUTE],
    ["day scale", 3 * DAY, 5 * MINUTE],
  ])("ticks %s at the unit it displays", (_label, ageMs, expected) => {
    expect(relativeTickMs(ageMs)).toBe(expected);
  });

  it("stops ticking once the rendering is a fixed date", () => {
    expect(relativeTickMs(RELATIVE_TIME_MAX_AGE_MS)).toBeNull();
  });

  it("ticks a future timestamp at its distance, not its sign", () => {
    expect(relativeTickMs(-30 * SECOND)).toBe(5 * SECOND);
    expect(relativeTickMs(-5 * HOUR)).toBe(5 * MINUTE);
  });
});
