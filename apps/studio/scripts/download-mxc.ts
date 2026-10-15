// Vendors MXC's Windows launcher (`wxc-exec.exe`, from Microsoft's MIT
// `@microsoft/mxc-sdk`) into `resources/mxc/`, which ships in the
// `app.asar.unpacked` tree beside uv. Native commands start through it on
// Windows once its canary passed (packages/workspace/src/lib/mxc-canary.ts).
// Only the launcher is kept: it runs on its own, and the SDK's Node bindings
// are not used. Downloads the package from the npm registry, checks it
// against the hash pinned here, and does nothing for a target other than
// Windows. Run from dev setup and before every package build.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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

const RESOURCES_MXC_DIR = path.resolve(import.meta.dirname, "../resources/mxc");

const VERSION = "1.0.0";
const TARBALL = `https://registry.npmjs.org/@microsoft/mxc-sdk/-/mxc-sdk-${VERSION}.tgz`;
const TARBALL_SHA256 =
  "39e59ffd9d0832334889b0cd583d0beb43b1bbbe9f783dd7c6980203d23e9602";

type NodeArch = "arm64" | "x64";

// Honor electron-builder's ARCH convention so a cross-arch package build
// vendors the right binary; fall back to the host arch otherwise.
function resolveArch(): NodeArch {
  const arch = process.env.ARCH ?? process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for MXC: ${arch}`);
}

async function main() {
  const platform = process.env.TARGET_PLATFORM ?? process.platform;
  if (platform !== "win32") {
    return;
  }
  const arch = resolveArch();
  const exec = path.join(RESOURCES_MXC_DIR, "wxc-exec.exe");
  const marker = path.join(RESOURCES_MXC_DIR, ".version");
  const version = `${VERSION} ${arch} ${TARBALL_SHA256.slice(0, 12)}`;
  if (
    existsSync(exec) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version
  ) {
    console.log(`MXC (${arch}) already vendored, skipping.`);
    return;
  }
  console.log(`Downloading @microsoft/mxc-sdk ${VERSION}...`);
  const response = await fetch(TARBALL);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${TARBALL}: ${response.status} ${response.statusText}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== TARBALL_SHA256) {
    throw new Error(
      `Checksum mismatch for ${TARBALL}: expected ${TARBALL_SHA256}, got ${actual}`,
    );
  }
  const extractDir = mkdtempSync(path.join(tmpdir(), "mxc-download-"));
  try {
    writeFileSync(path.join(extractDir, "mxc.tgz"), bytes);
    // Run from the folder with a relative name: Git's GNU tar on Windows
    // reads `D:\...` as a remote host.
    execFileSync("tar", ["-xzf", "mxc.tgz"], {
      cwd: extractDir,
      stdio: "inherit",
    });
    rmSync(RESOURCES_MXC_DIR, { force: true, recursive: true });
    mkdirSync(RESOURCES_MXC_DIR, { recursive: true });
    copyFileSync(
      path.join(extractDir, "package", "bin", arch, "wxc-exec.exe"),
      exec,
    );
    copyFileSync(
      path.join(extractDir, "package", "LICENSE.md"),
      path.join(RESOURCES_MXC_DIR, "LICENSE.md"),
    );
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
  writeFileSync(marker, `${version}\n`);
  console.log(`Vendored MXC (${arch}) to ${RESOURCES_MXC_DIR}`);
}

await main();
