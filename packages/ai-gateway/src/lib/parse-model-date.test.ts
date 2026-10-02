import { describe, expect, it } from "vitest";

import { modelReleaseDate } from "./parse-model-date";

describe("modelReleaseDate", () => {
  it.each([
    { date: 1_700_000_000, expected: "2023-11-14", name: "unix seconds" },
    // The one that took a whole model list down: read as seconds this is the
    // year 58,006, which a `Date` holds and `toISOString` writes as
    // "+058006-09-13...". Sliced to ten characters that is "+058006-09", which
    // is not a date, and the model carrying it failed the list's own schema --
    // so every model in the response went with it.
    {
      date: 1_767_000_000_000,
      expected: "2025-12-29",
      name: "milliseconds, which our own gateway sends",
    },
    {
      date: "2026-03-01T10:00:00Z",
      expected: "2026-03-01",
      name: "an ISO timestamp",
    },
    { date: "2026-03-01", expected: "2026-03-01", name: "a plain date" },
    { date: undefined, expected: undefined, name: "no date" },
    { date: "soon", expected: undefined, name: "a date that does not parse" },
  ])("reads $name", ({ date, expected }) => {
    expect(modelReleaseDate(date)).toBe(expected);
  });
});
