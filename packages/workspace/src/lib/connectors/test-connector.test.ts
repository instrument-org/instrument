import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { type ApiConnectorManifest } from "./manifest";
import { runConnectorTest } from "./test-connector";

let tmpDir: string;
let connectorsDir: string;
let server: http.Server;
let baseUrl: string;
let lastAuthHeader: null | string;
let lastVersionHeader: null | string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "connector-test-"));
  connectorsDir = path.join(tmpDir, "connectors");
  await fs.mkdir(connectorsDir, { recursive: true });

  lastAuthHeader = null;
  lastVersionHeader = null;
  server = http.createServer((req, res) => {
    lastAuthHeader = req.headers.authorization ?? null;
    lastVersionHeader = req.headers["x-api-version"]?.toString() ?? null;
    if (req.url?.startsWith("/me") === true) {
      if (req.headers.authorization === "Bearer good-token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
      }
      return;
    }
    // GraphQL-style: only answers POST, used to exercise the POST canary.
    if (req.url?.startsWith("/graphql") === true) {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { viewer: { id: "u1" } } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  await fs.rm(tmpDir, { force: true, recursive: true });
});

function run(slug: string, credential: null | string) {
  return runConnectorTest({
    connectorsDir: AbsolutePathSchema.parse(connectorsDir),
    getCredential: () => Promise.resolve(credential),
    signal: AbortSignal.timeout(10_000),
    slug,
  });
}

function statusByName(report: Awaited<ReturnType<typeof run>>) {
  return Object.fromEntries(
    report.checks.map((check) => [check.name, check.status]),
  );
}

async function writeConnector({
  guide = "# Test API\n\nGET /me returns the current user.",
  manifest = {},
  slug = "test-api",
}: {
  guide?: null | string;
  manifest?: Partial<ApiConnectorManifest>;
  slug?: string;
} = {}) {
  const dir = path.join(connectorsDir, slug);
  await fs.mkdir(dir, { recursive: true });
  const full: ApiConnectorManifest = {
    auth: { kind: "bearer" },
    baseUrl,
    displayName: "Test API",
    enabled: false,
    test: { path: "/me" },
    type: "api",
    ...manifest,
  };
  await fs.writeFile(
    path.join(dir, "connector.json"),
    JSON.stringify(full, null, 2),
  );
  if (guide !== null) {
    await fs.writeFile(path.join(dir, "guide.md"), guide);
  }
  return slug;
}

describe("runConnectorTest", () => {
  it("passes a valid connector with a working credential", async () => {
    const slug = await writeConnector();
    const report = await run(slug, "good-token");

    expect(report.passed).toBe(true);
    expect(lastAuthHeader).toBe("Bearer good-token");
    expect(statusByName(report)).toMatchInlineSnapshot(`
      {
        "canary-request": "pass",
        "credential": "pass",
        "guide": "pass",
        "manifest": "pass",
        "secret-scan": "pass",
        "type": "pass",
      }
    `);
  });

  it("fails the canary when the credential is rejected", async () => {
    const slug = await writeConnector();
    const report = await run(slug, "bad-token");

    expect(report.passed).toBe(false);
    const canary = report.checks.find((c) => c.name === "canary-request");
    expect(canary?.status).toBe("fail");
    expect(canary?.detail).toContain("401");
  });

  it("fails without a guide", async () => {
    const slug = await writeConnector({ guide: null });
    const report = await run(slug, "good-token");

    expect(report.passed).toBe(false);
    expect(statusByName(report).guide).toBe("fail");
  });

  it("fails without a stored credential", async () => {
    const slug = await writeConnector();
    const report = await run(slug, null);

    expect(report.passed).toBe(false);
    expect(statusByName(report).credential).toBe("fail");
    // The canary is skipped rather than attempted without auth.
    expect(statusByName(report)["canary-request"]).toBe("skip");
  });

  it("fails when a connector file contains the stored credential", async () => {
    const slug = await writeConnector({
      guide: "# Test API\n\nUse token good-token for auth.",
    });
    const report = await run(slug, "good-token");

    expect(report.passed).toBe(false);
    expect(statusByName(report)["secret-scan"]).toBe("fail");
  });

  it("fails when a connector file contains a secret-shaped string", async () => {
    const slug = await writeConnector({
      guide: `# Test API\n\nExample: ghp_${"a".repeat(24)}`,
    });
    const report = await run(slug, "good-token");

    expect(report.passed).toBe(false);
    expect(statusByName(report)["secret-scan"]).toBe("fail");
  });

  it("fails an invalid manifest and skips the rest", async () => {
    const dir = path.join(connectorsDir, "broken");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "connector.json"), "{ not json");

    const report = await run("broken", null);
    expect(report.passed).toBe(false);
    expect(statusByName(report)).toMatchInlineSnapshot(`
      {
        "canary-request": "skip",
        "credential": "skip",
        "guide": "skip",
        "manifest": "fail",
        "secret-scan": "skip",
        "type": "skip",
      }
    `);
  });

  it("uses a POST canary with a body when the manifest asks for it", async () => {
    const slug = await writeConnector({
      manifest: {
        auth: { header: "Authorization", kind: "header" },
        test: {
          body: JSON.stringify({ query: "{ viewer { id } }" }),
          method: "POST",
          path: "/graphql",
        },
      },
    });
    // header auth sends the raw credential; the mock accepts any non-empty key.
    const report = await run(slug, "any-key");

    expect(report.passed).toBe(true);
    const canary = report.checks.find((c) => c.name === "canary-request");
    expect(canary?.status).toBe("pass");
    expect(canary?.detail).toContain("POST /graphql");
  });

  it("sends static manifest headers with the canary request", async () => {
    const slug = await writeConnector({
      manifest: { headers: { "X-Api-Version": "2022-06-28" } },
    });
    const report = await run(slug, "good-token");

    expect(report.passed).toBe(true);
    expect(lastVersionHeader).toBe("2022-06-28");
  });

  it("skips the credential check for auth kind none", async () => {
    const slug = await writeConnector({
      manifest: { auth: { kind: "none" }, test: { path: "/me" } },
    });
    // /me requires auth in the mock server, so the canary fails, but the
    // credential check itself is a skip.
    const report = await run(slug, null);
    expect(statusByName(report).credential).toBe("skip");
  });
});
