import { describe, expect, it } from "vitest";

import { splitPastedCode, UnusableCodeError } from "./sign-in";

describe("splitPastedCode", () => {
  it.each([
    ["abc123#state-1", null, { code: "abc123", state: "state-1" }],
    ["  abc123#state-1\n", null, { code: "abc123", state: "state-1" }],
    ["abc123", "from-link", { code: "abc123", state: "from-link" }],
    ["abc123#from-link", "from-link", { code: "abc123", state: "from-link" }],
  ])("reads %j", (pasted, stateOfLink, expected) => {
    expect(splitPastedCode(pasted, stateOfLink)).toEqual(expected);
  });

  it.each([
    ["", "from-link"],
    ["#state-1", null],
    ["abc123", null],
    ["abc123#earlier-link", "from-link"],
  ])("refuses %j", (pasted, stateOfLink) => {
    expect(() => splitPastedCode(pasted, stateOfLink)).toThrow(UnusableCodeError);
  });
});
