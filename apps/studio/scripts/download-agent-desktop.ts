// Vendors agent-desktop (Apache-2.0, vercel-labs/agent-desktop) into
// `resources/agent-desktop/`, which ships in the signed `app.asar.unpacked`
// tree beside uv. Its helper has to stay beside the executable. Studio runs it
// as a plain child of the main process (`lib/computer-use.ts`), so macOS holds
// the app responsible for it and the app's Accessibility grant covers it.
// Checks each download against the hash pinned here, and does nothing for a
// target other than macOS. Run from dev setup and before every package build.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RESOURCES_DIR = path.resolve(
  import.meta.dirname,
  "../resources/agent-desktop",
);

const VERSION = "1.1.0";
const RELEASE = `https://github.com/vercel-labs/agent-desktop/releases/download/v${VERSION}`;

// From the release's checksums.txt.
const TARGETS = {
  arm64: {
    asset: `agent-desktop-v${VERSION}-aarch64-apple-darwin.tar.gz`,
    sha256: "3048e00aa0741bf25ffe0326f78c966408be4490ce13513f3f94ecf2a0b5270d",
  },
  x64: {
    asset: `agent-desktop-v${VERSION}-x86_64-apple-darwin.tar.gz`,
    sha256: "b6352ac66aa49e0280c6f690de791dc03c827623a838950856b20ddbebcdc382",
  },
} as const;

// The archives carry no license, so the text is taken from the tagged source.
const LICENSE_URL = `https://raw.githubusercontent.com/vercel-labs/agent-desktop/v${VERSION}/LICENSE`;
const LICENSE_SHA256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

const FILES = ["agent-desktop", "agent-desktop-macos-helper"];

// Honor electron-builder's ARCH convention so a cross-arch package build
// vendors the right binary; fall back to the host arch otherwise.
function resolveArch(): keyof typeof TARGETS {
  const arch = process.env.ARCH ?? process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for agent-desktop: ${arch}`);
}

async function download(url: string, sha256: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(
      `Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`,
    );
  }
  return bytes;
}

async function main() {
  const platform = process.env.TARGET_PLATFORM ?? process.platform;
  if (platform !== "darwin") {
    return;
  }
  const arch = resolveArch();
  const { asset, sha256 } = TARGETS[arch];
  const marker = path.join(RESOURCES_DIR, ".version");
  const version = `${VERSION} ${arch}`;
  if (
    FILES.every((file) => existsSync(path.join(RESOURCES_DIR, file))) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version
  ) {
    console.log(`agent-desktop (${arch}) already vendored, skipping.`);
    return;
  }
  console.log(`Downloading agent-desktop ${VERSION}...`);
  const archive = await download(`${RELEASE}/${asset}`, sha256);
  const license = await download(LICENSE_URL, LICENSE_SHA256);
  const extractDir = mkdtempSync(path.join(tmpdir(), "agent-desktop-"));
  try {
    writeFileSync(path.join(extractDir, asset), archive);
    execFileSync("tar", ["-xzf", asset], {
      cwd: extractDir,
      stdio: "inherit",
    });
    rmSync(RESOURCES_DIR, { force: true, recursive: true });
    mkdirSync(RESOURCES_DIR, { recursive: true });
    for (const file of FILES) {
      const target = path.join(RESOURCES_DIR, file);
      copyFileSync(path.join(extractDir, file), target);
      chmodSync(target, 0o755);
    }
    writeFileSync(path.join(RESOURCES_DIR, "LICENSE"), license);
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
  writeFileSync(marker, `${version}\n`);
  console.log(`Vendored agent-desktop (${arch}) to ${RESOURCES_DIR}`);
}

await main();
