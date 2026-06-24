// Vendors the official `uv` binary into `resources/uv/` so it ships in the
// signed `app.asar.unpacked` tree (mirrors how ripgrep/agent-browser are
// bundled). We download the checksum-verified artifact from Astral's GitHub
// releases for the build's target, rather than depending on a third-party npm
// mirror that lags upstream. Run from dev setup and before every package build
// (see apps/studio/package.json `uv:download`).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Pin the uv release. Bump deliberately; the binary is checksum-verified below.
const UV_VERSION = "0.9.7";

const RESOURCES_UV_DIR = path.resolve(import.meta.dirname, "../resources/uv");

type NodeArch = "arm64" | "x64";
type NodePlatform = "darwin" | "linux" | "win32";

// uv publishes binaries keyed by rust target triple. We only ship the targets
// Studio builds for.
const TARGET_TRIPLES: Record<NodePlatform, Record<NodeArch, string>> = {
  darwin: {
    arm64: "aarch64-apple-darwin",
    x64: "x86_64-apple-darwin",
  },
  linux: {
    arm64: "aarch64-unknown-linux-gnu",
    x64: "x86_64-unknown-linux-gnu",
  },
  win32: {
    // cspell:ignore msvc
    arm64: "aarch64-pc-windows-msvc",
    x64: "x86_64-pc-windows-msvc",
  },
};

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

// uv tarballs nest the binary under `uv-<target>/`; the Windows zip keeps it at
// the root. Search both layouts.
function findUvBinary(extractDir: string, binaryName: string): string {
  const direct = path.join(extractDir, binaryName);
  if (existsSync(direct)) {
    return direct;
  }
  for (const entry of readdirSync(extractDir)) {
    const nested = path.join(extractDir, entry, binaryName);
    if (existsSync(nested)) {
      return nested;
    }
  }
  throw new Error(
    `Could not find ${binaryName} in extracted uv archive at ${extractDir}`,
  );
}

async function main() {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const target = TARGET_TRIPLES[platform][arch];
  const binaryName = platform === "win32" ? "uv.exe" : "uv";
  const destPath = path.join(RESOURCES_UV_DIR, binaryName);
  const versionMarker = path.join(RESOURCES_UV_DIR, ".version");

  const cachedVersion = existsSync(versionMarker)
    ? readFileSync(versionMarker, "utf8").trim()
    : undefined;
  if (existsSync(destPath) && cachedVersion === `${UV_VERSION}-${target}`) {
    console.log(`uv ${UV_VERSION} (${target}) already vendored, skipping.`);
    return;
  }

  const ext = platform === "win32" ? "zip" : "tar.gz";
  const asset = `uv-${target}.${ext}`;
  const baseUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;

  console.log(`Downloading ${asset} (uv ${UV_VERSION})...`);
  const [archive, checksumText] = await Promise.all([
    fetchBuffer(`${baseUrl}/${asset}`),
    fetchBuffer(`${baseUrl}/${asset}.sha256`).then((b) => b.toString("utf8")),
  ]);

  const expected = parseChecksum(checksumText);
  const actual = sha256(archive);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`,
    );
  }

  const extractDir = mkdtempSync(path.join(tmpdir(), "uv-download-"));
  try {
    const archivePath = path.join(extractDir, asset);
    writeFileSync(archivePath, archive);
    // cspell:ignore bsdtar
    // `tar` (bsdtar) ships on macOS, Linux, and Windows 10+ and autodetects
    // both .tar.gz and .zip, so we avoid an unzip dependency.
    execFileSync("tar", ["-xf", archivePath, "-C", extractDir], {
      stdio: "inherit",
    });

    const uvBinary = findUvBinary(extractDir, binaryName);
    mkdirSync(RESOURCES_UV_DIR, { recursive: true });
    copyFileSync(uvBinary, destPath);
    if (platform !== "win32") {
      chmodSync(destPath, 0o755);
    }
    writeFileSync(versionMarker, `${UV_VERSION}-${target}\n`);
    console.log(`Vendored uv ${UV_VERSION} (${target}) to ${destPath}`);
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
}

// The `.sha256` sidecar is `"<hex>  <filename>"`; take the first token.
function parseChecksum(text: string): string {
  const hex = text.trim().split(/\s+/)[0];
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`Unexpected .sha256 contents: ${text.slice(0, 80)}`);
  }
  return hex.toLowerCase();
}

// Honor electron-builder's ARCH convention (used in electron-builder.ts) so a
// cross-arch package build (e.g. mac x64 on an arm runner) vendors the right
// binary; fall back to the host arch otherwise.
function resolveArch(): NodeArch {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const arch = process.env.ARCH ?? process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for uv: ${arch}`);
}

// Honor a TARGET_PLATFORM override (mirrors the ARCH convention above) so a
// cross-platform package build (e.g. a Windows `--dir` build on macOS) vendors
// the right binary; fall back to the host platform otherwise.
function resolvePlatform(): NodePlatform {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const platform = process.env.TARGET_PLATFORM ?? process.platform;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform for uv: ${platform}`);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

await main();
