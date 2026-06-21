import {
  describe,
  expect,
  it,
} from "vitest";

import {
  isProjectSubdomain,
} from "./is-app";

describe("isProjectSubdomain", () => {
  it.each([
    ["my-app", true],
    ["test123", true],
    ["chat-old-project", true],
    ["eval-123", true],
    ["my-app.preview", false],
    ["sandbox-test.my-app", false],
    ["version-abc.my-app", false],
  ])("should return %s for %s", (subdomain, expected) => {
    expect(isProjectSubdomain(subdomain)).toBe(expected);
  });
});
