import { describe, expect, it } from "vitest";

import { asksOwnPlace, ownPlaceOf } from "./context";

describe("ownPlaceOf", () => {
  it.each([
    [undefined, undefined],
    [{ show: true }, undefined],
    [{ group: "chat", ownTab: true, show: true }, undefined],
    [{ newTab: true }, { behind: undefined, newTab: true }],
    [
      { behind: true, newTab: true, show: true },
      { behind: true, newTab: true },
    ],
    [{ newWindow: true }, { newWindow: true }],
    [{ group: "chat", newWindow: true, show: true }, { newWindow: true }],
  ])("passes on %o as %o", (options, expected) => {
    expect(ownPlaceOf(options)).toEqual(expected);
    expect(asksOwnPlace(options)).toBe(expected !== undefined);
  });
});
