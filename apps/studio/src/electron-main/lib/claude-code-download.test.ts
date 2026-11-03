import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app runs the binary this installs, so a download that matches neither
// npm's integrity hash nor Anthropic's checksum must never land where
// `installedCopy` looks.

const userData = { dir: "" };
const fetchMock = vi.fn<(url: string) => Promise<Response>>();
vi.mock("electron", () => ({
  app: { getPath: () => userData.dir },
  net: { fetch: (url: string) => fetchMock(url) },
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {} }),
}));

const BINARY = "claude";
const release = {
  binary: BINARY,
  packageName: "@anthropic-ai/claude-code-test",
  packageVersion: "1.0.0",
  sha256: "",
  size: 0,
  version: "2.1.300",
};
vi.mock("@instrument-org/ai-gateway", async (original) => ({
  ...(await original<typeof import("@instrument-org/ai-gateway")>()),
  claudeCodeRelease: () => release,
}));

const { currentCopy, downloadClaudeCode, installedCopy } =
  await import("./claude-code-download");

const root = () => path.join(userData.dir, "claude-code");

/** A package tarball holding `package/claude` with `contents`. */
function packTarball(contents: string): Buffer {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-"));
  fs.mkdirSync(path.join(src, "package"));
  fs.writeFileSync(path.join(src, "package", BINARY), contents);
  const tgz = path.join(src, "out.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", src, "package"]);
  const bytes = fs.readFileSync(tgz);
  fs.rmSync(src, { force: true, recursive: true });
  return bytes;
}

function serve(tarball: Buffer, integrity: string) {
  fetchMock.mockImplementation(async (url) =>
    url.startsWith("https://registry.npmjs.org/")
      ? Response.json({
          dist: { integrity, tarball: "https://example.test/claude.tgz" },
        })
      : new Response(new Uint8Array(tarball)),
  );
}

const sha512 = (bytes: Buffer) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

describe("downloadClaudeCode", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-userdata-"));
    release.sha256 = createHash("sha256").update("real binary").digest("hex");
    release.size = "real binary".length;
  });
  afterEach(() => {
    fs.rmSync(userData.dir, { force: true, recursive: true });
  });

  it("installs a verified copy, clearing older copies and abandoned downloads", async () => {
    fs.mkdirSync(path.join(root(), "2.1.285"), { recursive: true });
    fs.mkdirSync(path.join(root(), ".download-left-over"));
    const tarball = packTarball("real binary");
    serve(tarball, sha512(tarball));

    const result = await downloadClaudeCode(() => {});

    const installed = path.join(root(), release.version, BINARY);
    expect(result.value).toBe(installed);
    expect(fs.readFileSync(installed, "utf8")).toBe("real binary");
    expect(fs.statSync(installed).mode & 0o111).not.toBe(0);
    expect(fs.readdirSync(root())).toEqual([release.version]);
    expect(await installedCopy()).toBe(installed);
  });

  it.each([
    {
      expected: "The Claude Code download didn't match npm's integrity hash.",
      integrity: () => `sha512-${Buffer.from("other").toString("base64")}`,
      name: "npm's integrity hash",
      packed: "real binary",
    },
    {
      expected: "Claude Code didn't match Anthropic's checksum.",
      // npm's hash agrees with the tarball; the binary inside is not Anthropic's.
      integrity: (tarball: Buffer) => sha512(tarball),
      name: "Anthropic's checksum",
      packed: "tampered",
    },
  ])(
    "installs nothing when the download fails $name",
    async ({ expected, integrity, packed }) => {
      const tarball = packTarball(packed);
      serve(tarball, integrity(tarball));

      const result = await downloadClaudeCode(() => {});

      expect(result.error).toMatchObject({
        failedStage: "verify",
        message: expected,
      });
      // Not installed, and the staging folder is gone.
      expect(fs.readdirSync(root())).toEqual([]);
      expect(await installedCopy()).toBeUndefined();
    },
  );
});

describe("installedCopy", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-userdata-"));
    release.size = 5;
  });
  afterEach(() => {
    fs.rmSync(userData.dir, { force: true, recursive: true });
  });

  const place = (version: string, contents = "x") => {
    fs.mkdirSync(path.join(root(), version), { recursive: true });
    fs.writeFileSync(path.join(root(), version, BINARY), contents);
  };

  // An app update must not sign the person out before the new copy is down,
  // but a copy older than this build runs is never used.
  it("runs the newest older copy this build still runs until the wanted one is whole", async () => {
    place("2.1.284");
    place("2.1.286");
    place("2.1.290");
    place(".download-x");
    expect(await installedCopy()).toBe(path.join(root(), "2.1.290", BINARY));
    place(release.version, "whole");
    expect(await installedCopy()).toBe(path.join(root(), "2.1.300", BINARY));
    fs.rmSync(path.join(root(), release.version), { recursive: true });
    fs.rmSync(path.join(root(), "2.1.290"), { recursive: true });
    fs.rmSync(path.join(root(), "2.1.286"), { recursive: true });
    expect(await installedCopy()).toBeUndefined();
  });
});

describe("currentCopy", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-userdata-"));
    release.size = 5;
  });
  afterEach(() => {
    fs.rmSync(userData.dir, { force: true, recursive: true });
  });

  // A copy cut short is not the release, so the app downloads it again.
  it("counts the wanted copy only at its full size", async () => {
    const binary = path.join(root(), release.version, BINARY);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "ab");
    expect(await currentCopy()).toBeUndefined();
    fs.writeFileSync(binary, "whole");
    expect(await currentCopy()).toBe(binary);
  });
});
