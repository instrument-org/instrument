import { describe, expect, it } from "vitest";

import { isAtOrUnder, isUnder, relativeWithin } from "./path-containment";

describe("relativeWithin", () => {
  it.each([
    ["the root itself", "/task", "/"],
    ["a child", "/task/output/report.pdf", "/output/report.pdf"],
    ["a trailing slash on the root", "/task/", "/"],
    ["a sibling sharing a prefix", "/tasks/output", null],
    ["a longer name", "/task-2/output", null],
    ["an unrelated mount", "/mnt/Photos", null],
    ["a bare relative path", "output/report.pdf", null],
  ])("%s", (_case, virtualPath, expected) => {
    expect(relativeWithin("/task", virtualPath)).toBe(expected);
  });
});

// The pair exists because callers disagree about the root, and picking the
// wrong one fails in whichever direction nobody was looking.
describe("the root itself", () => {
  it("is contained by isAtOrUnder and not by isUnder", () => {
    expect(isAtOrUnder("/task", "/task")).toBe(true);
    expect(isUnder("/task", "/task")).toBe(false);
  });

  it.each(["/task/output", "/task/output/report.pdf"])(
    "agrees about %s",
    (virtualPath) => {
      expect(isAtOrUnder("/task", virtualPath)).toBe(true);
      expect(isUnder("/task", virtualPath)).toBe(true);
    },
  );

  it.each(["/tasks/output", "/task-2", "/mnt/Photos", "output"])(
    "agrees about %s",
    (virtualPath) => {
      expect(isAtOrUnder("/task", virtualPath)).toBe(false);
      expect(isUnder("/task", virtualPath)).toBe(false);
    },
  );
});
