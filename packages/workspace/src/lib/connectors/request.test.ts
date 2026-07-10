import { describe, expect, it } from "vitest";

import { ConnectorManifestSchema } from "./manifest";
import { buildConnectorUrl, redactCredential } from "./request";

describe("buildConnectorUrl", () => {
  const urlCases: {
    expected: string;
    name: string;
    params: Record<string, string>;
    path: string;
  }[] = [
    {
      expected: "https://api.example.com/v1/pages",
      name: "joins a path onto the base origin",
      params: {},
      path: "/v1/pages",
    },
    {
      expected: "https://api.example.com/v1/pages?limit=10",
      name: "appends query params",
      params: { limit: "10" },
      path: "/v1/pages",
    },
    {
      expected: "https://api.example.com/v1/pages?a=1&b=2",
      name: "keeps inline query strings and merges params",
      params: { b: "2" },
      path: "/v1/pages?a=1",
    },
    {
      expected: "https://api.example.com/v1/pages",
      name: "accepts paths without a leading slash",
      params: {},
      path: "v1/pages",
    },
  ];

  it.each(urlCases)("$name", ({ expected, params, path }) => {
    const result = buildConnectorUrl({
      baseUrl: "https://api.example.com",
      params,
      path,
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().toString()).toBe(expected);
  });

  it("keeps requests under a base path", () => {
    const result = buildConnectorUrl({
      baseUrl: "https://example.com/api",
      params: {},
      path: "/pages",
    });
    expect(result._unsafeUnwrap().toString()).toBe(
      "https://example.com/api/pages",
    );
  });

  it("accepts (and encodes) valid paths with spaces and non-ASCII", () => {
    const space = buildConnectorUrl({
      baseUrl: "https://api.example.com/v1",
      params: {},
      path: "/search/my file",
    });
    expect(space._unsafeUnwrap().pathname).toBe("/v1/search/my%20file");

    const unicode = buildConnectorUrl({
      baseUrl: "https://api.example.com/v1",
      params: {},
      path: "/café",
    });
    expect(unicode._unsafeUnwrap().pathname).toBe("/v1/caf%C3%A9");
  });

  it("rejects percent-encoded traversal that escapes the base path", () => {
    const result = buildConnectorUrl({
      baseUrl: "https://api.example.com/v1",
      params: {},
      path: "/%2e%2e/outside",
    });
    expect(result.isErr()).toBe(true);
  });

  it.each([
    { name: "rejects full URLs", path: "https://evil.example.com/steal" },
    { name: "rejects protocol-relative URLs", path: "//evil.example.com" },
    { name: "rejects base-path escapes", path: "/../outside" },
  ])("$name", ({ path }) => {
    const result = buildConnectorUrl({
      baseUrl: "https://example.com/api",
      params: {},
      path,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("ConnectorManifestSchema baseUrl", () => {
  const manifest = (baseUrl: string) => ({
    auth: { kind: "bearer" },
    baseUrl,
    displayName: "Test",
    enabled: true,
    test: { path: "/ok" },
    type: "api",
  });

  it.each([
    { baseUrl: "https://api.example.com", ok: true },
    { baseUrl: "http://127.0.0.1:8080", ok: true },
    { baseUrl: "http://localhost:3000", ok: true },
    { baseUrl: "http://api.example.com", ok: false },
    { baseUrl: "https://user:pass@api.example.com", ok: false },
    { baseUrl: "not-a-url", ok: false },
  ])("$baseUrl -> $ok", ({ baseUrl, ok }) => {
    expect(ConnectorManifestSchema.safeParse(manifest(baseUrl)).success).toBe(
      ok,
    );
  });
});

describe("ConnectorManifestSchema strictness", () => {
  const base = {
    auth: { kind: "bearer" },
    baseUrl: "https://api.example.com",
    displayName: "Test",
    enabled: true,
    test: { path: "/ok" },
    type: "api",
  };

  it("accepts static headers", () => {
    expect(
      ConnectorManifestSchema.safeParse({
        ...base,
        headers: { "Notion-Version": "2022-06-28" },
      }).success,
    ).toBe(true);
  });

  // Agents repair manifests from validation errors; a silently-stripped
  // unknown key would send them guessing key names forever.
  it.each([
    { name: "unknown top-level key", value: { ...base, defaultHeaders: {} } },
    {
      name: "slug does not belong in the manifest",
      value: { ...base, slug: "x" },
    },
    {
      name: "unknown key inside auth",
      value: { ...base, auth: { header: "Authorization", kind: "bearer" } },
    },
    {
      name: "unknown key inside test",
      value: { ...base, test: { path: "/ok", verb: "GET" } },
    },
  ])("rejects $name", ({ value }) => {
    expect(ConnectorManifestSchema.safeParse(value).success).toBe(false);
  });
});

describe("redactCredential", () => {
  it("removes every occurrence of the credential", () => {
    expect(
      redactCredential("token=s3cret and again s3cret", "s3cret"),
    ).toMatchInlineSnapshot(`"token=[REDACTED] and again [REDACTED]"`);
  });

  it("passes text through when there is no credential", () => {
    expect(redactCredential("hello", null)).toBe("hello");
  });

  it("redacts the percent-encoded form of a URL-borne credential", () => {
    // A token with chars the URL layer encodes (+ / =).
    const token = "ab+cd/ef=gh";
    const encoded = encodeURIComponent(token); // ab%2Bcd%2Fef%3Dgh
    const text = `https://api.example.com/x?token=${encoded}`;
    const redacted = redactCredential(text, token);
    expect(redacted).not.toContain(encoded);
    expect(redacted).toContain("[REDACTED]");
  });
});
