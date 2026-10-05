import { describe, expect, it } from "vitest";

import { readRefusalOf } from "./read-refusal";

const failure = (code: string) => Object.assign(new Error(code), { code });

describe("readRefusalOf", () => {
  it.each([
    ["EPERM", "darwin", "system"],
    ["EPERM", "linux", "account"],
    ["EPERM", "win32", "account"],
    ["EACCES", "darwin", "account"],
    ["EACCES", "linux", "account"],
    ["ENOENT", "darwin", undefined],
  ] as const)("reads %s on %s as %s", (code, platform, reason) => {
    expect(readRefusalOf(failure(code), platform)).toBe(reason);
  });

  it("reads a failure with no code as no refusal", () => {
    expect(readRefusalOf(new Error("boom"), "darwin")).toBeUndefined();
  });
});
