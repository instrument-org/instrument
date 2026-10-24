import { describe, expect, it } from "vitest";

import { shortenCompareLinks } from "./shorten-compare-links";

describe("shortenCompareLinks", () => {
  it.each([
    [
      "**Full Changelog**: https://github.com/instrument-org/instrument/compare/v2.0.0-beta.102...v2.0.0-beta.103",
      "**Full Changelog**: [v2.0.0-beta.102...v2.0.0-beta.103](https://github.com/instrument-org/instrument/compare/v2.0.0-beta.102...v2.0.0-beta.103)",
    ],
    [
      "**Skills Changelog**: https://github.com/instrument-org/skills/compare/02fb11bc929f7c6c056fb9c2bd670aff14df014b...88db53696cfa4efd02080d8ab8134ffc1a2f9bcb",
      "**Skills Changelog**: [02fb11b...88db536](https://github.com/instrument-org/skills/compare/02fb11bc929f7c6c056fb9c2bd670aff14df014b...88db53696cfa4efd02080d8ab8134ffc1a2f9bcb)",
    ],
  ])("labels a bare compare URL with its range", (line, expected) => {
    expect(shortenCompareLinks(line)).toBe(expected);
  });

  it("leaves a compare URL that is already a link's target alone", () => {
    const line =
      "[changes](https://github.com/instrument-org/instrument/compare/v1...v2)";
    expect(shortenCompareLinks(line)).toBe(line);
  });
});
