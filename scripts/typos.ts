// Runs the spell checker, vendoring the binary on first use. `typos` is a Rust
// binary with no first-party npm package, so we fetch the checksum-verified
// artifact straight from crate-ci's GitHub releases rather than trusting a
// third-party npm mirror that would also need a postinstall allowance. The
// binary is cached under node_modules, so a clean install re-fetches it and
// nothing lands in the working tree.
//
// Arguments are forwarded, so `pnpm check:spelling --write-changes` applies the
// corrections and `pnpm check:spelling <path>` narrows the scan.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CACHE_DIR = path.resolve(
  import.meta.dirname,
  "../node_modules/.cache/typos",
);

// Bump deliberately, and refresh every checksum below with it. Get them from
// the release page, or by hashing each downloaded asset with `shasum -a 256`.
const TYPOS_VERSION = "1.49.0";

type NodeArch = "arm64" | "x64";
type NodePlatform = "darwin" | "linux" | "win32";

// sha256 of each release asset, keyed by rust target triple. Pinned here because
// crate-ci publishes no checksum sidecar to fetch alongside the archive.
const CHECKSUMS: Record<string, string> = {
  "aarch64-apple-darwin":
    "8c0e7bd40b2b60c0b0cfe9f74dd814b4d4385c956ce86860f7da9e62d91fdc73",
  "aarch64-unknown-linux-musl":
    "85c8b87b22a0fb1da130cd4d495e0beba7f1225eb580933184509e146ec4c509",
  "x86_64-apple-darwin":
    "4cecbf653a9fc45f023abf57f4e2e2f6b138c2d2387b09289beacdd3f0ea7bfd",
  "x86_64-pc-windows-msvc":
    "06d3a1b71c282e021671070696a72696d5c60ea485b47dc4f8f1fbcf90144d02",
  "x86_64-unknown-linux-musl":
    "48bd2d58e02ce713b8c0f1aa239e68ee4f7d8c551013135806e6aed3938d9e10",
};

// Linux builds are musl-only upstream, and there is no Windows arm64 artifact.
const TARGET_TRIPLES: Record<
  NodePlatform,
  Partial<Record<NodeArch, string>>
> = {
  darwin: {
    arm64: "aarch64-apple-darwin",
    x64: "x86_64-apple-darwin",
  },
  linux: {
    arm64: "aarch64-unknown-linux-musl",
    x64: "x86_64-unknown-linux-musl",
  },
  win32: {
    x64: "x86_64-pc-windows-msvc",
  },
};

// Ensure the pinned binary is cached and return its path.
async function ensureBinary(): Promise<string> {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const target = TARGET_TRIPLES[platform][arch];
  if (!target) {
    throw new Error(
      `typos publishes no ${platform} ${arch} build; skip the spelling check on this host`,
    );
  }

  const binaryName = platform === "win32" ? "typos.exe" : "typos";
  const versionDir = path.join(CACHE_DIR, `${TYPOS_VERSION}-${target}`);
  const destPath = path.join(versionDir, binaryName);
  if (existsSync(destPath)) {
    return destPath;
  }

  const expected = CHECKSUMS[target];
  if (!expected) {
    throw new Error(`No pinned checksum for ${target}; add one to CHECKSUMS`);
  }

  const ext = platform === "win32" ? "zip" : "tar.gz";
  const asset = `typos-v${TYPOS_VERSION}-${target}.${ext}`;
  console.log(`Downloading ${asset}...`);
  const archive = await fetchBuffer(
    `https://github.com/crate-ci/typos/releases/download/v${TYPOS_VERSION}/${asset}`,
  );

  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`,
    );
  }

  // Extract to a scratch dir and move the binary into place as the last step, so
  // a killed download never leaves a half-written binary that the cache check
  // above would treat as good.
  const extractDir = mkdtempSync(path.join(tmpdir(), "typos-download-"));
  try {
    const archivePath = path.join(extractDir, asset);
    writeFileSync(archivePath, archive);
    extractArchive({ archivePath, asset, ext, extractDir });
    mkdirSync(versionDir, { recursive: true });
    renameSync(path.join(extractDir, binaryName), destPath);
    if (platform !== "win32") {
      chmodSync(destPath, 0o755);
    }
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
  return destPath;
}

// The `tar` on Windows runners is often MSYS/Git GNU tar, which can't read zips
// and reads a `D:\...` path as a remote host. Use PowerShell there. Elsewhere
// `tar` is bsdtar, which autodetects the format; run it from `extractDir` with a
// relative archive name so a drive-letter path never reaches it.
function extractArchive({
  archivePath,
  asset,
  ext,
  extractDir,
}: {
  archivePath: string;
  asset: string;
  ext: string;
  extractDir: string;
}) {
  if (ext === "zip" && process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("tar", ["-xf", asset], { cwd: extractDir, stdio: "inherit" });
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveArch(): NodeArch {
  const { arch } = process;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for typos: ${arch}`);
}

function resolvePlatform(): NodePlatform {
  const { platform } = process;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform for typos: ${platform}`);
}

const binary = await ensureBinary();
const { status } = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
});
// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
process.exit(status ?? 1);
