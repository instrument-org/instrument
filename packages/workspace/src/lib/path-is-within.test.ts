import { describe, expect, it } from "vitest";

import { pathIsWithin } from "./path-is-within";

describe("pathIsWithin", () => {
  it.each([
    { candidate: "/foo/bar", expected: true, root: "/foo/bar" },
    { candidate: "/foo/bar/baz.txt", expected: true, root: "/foo/bar" },
    { candidate: "/foo/bar/a/b/c", expected: true, root: "/foo/bar" },
    // Sibling that merely shares a string prefix must NOT be inside.
    { candidate: "/foo/barista/x.txt", expected: false, root: "/foo/bar" },
    { candidate: "/foo/bar-2/x.txt", expected: false, root: "/foo/bar" },
    { candidate: "/other/bar/x.txt", expected: false, root: "/foo/bar" },
    // Trailing separator on the root is tolerated.
    { candidate: "/foo/bar/x", expected: true, root: "/foo/bar/" },
  ])(
    "$candidate within $root -> $expected",
    ({ candidate, expected, root }) => {
      expect(pathIsWithin(candidate, root)).toBe(expected);
    },
  );
});
