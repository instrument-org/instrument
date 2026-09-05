import { describe, expect, it } from "vitest";

import { modelReleaseDate } from "./parse-model-date";

describe("modelReleaseDate", () => {
  it.each([
    { date: 1_700_000_000, expected: "2023-11-14", name: "unix seconds" },
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
