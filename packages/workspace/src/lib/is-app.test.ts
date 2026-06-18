import { describe, expect, it } from "vitest";

import { isPreviewSubdomain, isProjectSubdomain } from "./is-app";

describe("isPreviewSubdomain", () => {
  it.each([
    ["my-app.preview", true],
    ["test123.preview", true],
    ["my-app", false],
    ["sandbox-test.my-app", false],
    ["version-abc.my-app", false],
    ["preview", false],
  ])("should return %s for %s", (subdomain, expected) => {
    expect(isPreviewSubdomain(subdomain)).toBe(expected);
  });
});

describe("isProjectSubdomain", () => {
  it.each([
    ["my-app", true],
    ["test123", true],
    ["chat-old-project", true],
    ["eval-123", true],
    ["my-app.preview", false],
    ["sandbox-test.my-app", false],
    ["version-abc.my-app", false],
    ["preview", false],
  ])("should return %s for %s", (subdomain, expected) => {
    expect(isProjectSubdomain(subdomain)).toBe(expected);
  });
});
