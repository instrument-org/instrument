// Vendors uutils (MIT-licensed Rust reimplementations of the GNU text tools)
// into `resources/uutils/` so they ship in the signed `app.asar.unpacked` tree
// beside uv, and the agent's shell runs GNU-compatible `sort`, `find`, `grep`
// and the rest natively on every platform. The archives come from
// instrument-org/uutils-build, which builds the upstream releases named below
// with the patches Studio needs (on Windows, `/` between the path components
// `find` and `grep` print) for every target Studio ships. Downloads the
// archive for the build's target, checks it against the hash pinned here,
// and keeps only the binaries the shell runs. Run from dev setup and before
// every package build (see apps/studio/package.json `uutils:download`).

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
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RESOURCES_UUTILS_DIR = path.resolve(
  import.meta.dirname,
  "../resources/uutils",
);

type NodeArch = "arm64" | "x64";
type NodePlatform = "darwin" | "linux" | "win32";
type Target = `${NodePlatform}-${NodeArch}`;

/** The instrument-org/uutils-build release, and what it was built from. */
const RELEASE = "2026.10.15";
const UPSTREAM = {
  coreutils: "0.12.0",
  diffutils: "0.5.0",
  findutils: "0.10.0",
  grep: "0.2.0",
};

/** The binaries every archive carries, base names without `.exe`. */
const BINARIES = ["coreutils", "diffutils", "find", "grep", "xargs"];

/**
 * Each target's archive and its sha256 as published. Linux takes musl builds,
 * which run on any distribution.
 */
const ARCHIVES: Record<Target, { asset: string; sha256: string }> = {
  "darwin-arm64": {
    asset: "uutils-aarch64-apple-darwin.tar.gz",
    sha256: "32097a0ba9c21af3b9da4de6a36f22278893f42cd0212c537596e72734dac08d",
  },
  "darwin-x64": {
    asset: "uutils-x86_64-apple-darwin.tar.gz",
    sha256: "0d79cd8ac74fb842a77beeb99b54080bc6dc3488d23fe199c96be91a7e8b92ba",
  },
  "linux-arm64": {
    asset: "uutils-aarch64-unknown-linux-musl.tar.gz",
    sha256: "93e26ee03055e9ed291b739a606a733a68f29b2e1d0a12d9df445d244b2dc9d5",
  },
  "linux-x64": {
    asset: "uutils-x86_64-unknown-linux-musl.tar.gz",
    sha256: "a98be7c295283bf443891daa7cd88149b66f3cdc544eb46e67a90c7633f3b295",
  },
  "win32-arm64": {
    asset: "uutils-aarch64-pc-windows-msvc.zip",
    sha256: "a60497f6e9e78cbba3479a676c54df59d12d8dfc4027515990d82aa4fa307a4b",
  },
  "win32-x64": {
    asset: "uutils-x86_64-pc-windows-msvc.zip",
    sha256: "77812ad386bbe9175a9f9da6e529c3c86ee5ee110f005361426a0f1bc21727d5",
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

/**
 * Extract an archive into `extractDir`. On Windows the `tar` on PATH is often
 * Git's GNU tar, which cannot read a zip and parses `D:\...` as a remote host,
 * so a zip goes through PowerShell there; elsewhere `tar` is bsdtar or GNU tar
 * with xz, run from `extractDir` with a relative name.
 */
function extractArchive(asset: string, extractDir: string) {
  if (asset.endsWith(".zip") && process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${path.join(extractDir, asset)}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("tar", ["-xf", asset], { cwd: extractDir, stdio: "inherit" });
}

/** The first file named `name` under `dir`, searched breadth first. */
function findFile(dir: string, name: string): string | undefined {
  const queue = [dir];
  for (let current = queue.shift(); current; current = queue.shift()) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isFile() && entry.name === name) {
        return full;
      }
      if (entry.isDirectory()) {
        queue.push(full);
      }
    }
  }
  return undefined;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function vendor(
  { asset, sha256: expected }: { asset: string; sha256: string },
  platform: NodePlatform,
) {
  const url = `https://github.com/instrument-org/uutils-build/releases/download/${RELEASE}/${asset}`;
  console.log(`Downloading ${asset}...`);
  const bytes = await fetchBuffer(url);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`,
    );
  }
  const extractDir = mkdtempSync(path.join(tmpdir(), "uutils-download-"));
  try {
    writeFileSync(path.join(extractDir, asset), bytes);
    extractArchive(asset, extractDir);
    for (const binary of BINARIES) {
      const fileName = platform === "win32" ? `${binary}.exe` : binary;
      const found = findFile(extractDir, fileName);
      if (!found) {
        throw new Error(`Could not find ${fileName} in ${asset}`);
      }
      const dest = path.join(RESOURCES_UUTILS_DIR, fileName);
      copyFileSync(found, dest);
      if (platform !== "win32") {
        chmodSync(dest, 0o755);
      }
    }
    // Every license text the archive carries, one folder per project under
    // licenses/ (diffutils is MIT or Apache), flattened into the licenses/
    // the packaged app's licenses folder copies whole.
    const licensesDir = path.join(extractDir, "licenses");
    mkdirSync(path.join(RESOURCES_UUTILS_DIR, "licenses"), { recursive: true });
    for (const project of readdirSync(licensesDir)) {
      for (const name of readdirSync(path.join(licensesDir, project))) {
        copyFileSync(
          path.join(licensesDir, project, name),
          path.join(RESOURCES_UUTILS_DIR, "licenses", `${project}-${name}`),
        );
      }
    }
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
}

// Honor electron-builder's ARCH convention so a cross-arch package build
// vendors the right binaries; fall back to the host arch otherwise.
function resolveArch(): NodeArch {
  const arch = process.env.ARCH ?? process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for uutils: ${arch}`);
}

// Honor a TARGET_PLATFORM override, as download-uv.ts does.
function resolvePlatform(): NodePlatform {
  const platform = process.env.TARGET_PLATFORM ?? process.platform;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform for uutils: ${platform}`);
}

async function main() {
  const platform = resolvePlatform();
  const target: Target = `${platform}-${resolveArch()}`;
  const archive = ARCHIVES[target];
  const marker = path.join(RESOURCES_UUTILS_DIR, ".version");
  // "3" is the layout: binaries, licenses/ and .versions.
  const version = `3 ${target} ${archive.sha256.slice(0, 12)}`;
  const vendored =
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version &&
    BINARIES.every((binary) =>
      existsSync(
        path.join(
          RESOURCES_UUTILS_DIR,
          platform === "win32" ? `${binary}.exe` : binary,
        ),
      ),
    );
  if (vendored) {
    console.log(`uutils (${target}) already vendored, skipping.`);
    return;
  }
  rmSync(RESOURCES_UUTILS_DIR, { force: true, recursive: true });
  mkdirSync(RESOURCES_UUTILS_DIR, { recursive: true });
  await vendor(archive, platform);
  writeFileSync(marker, `${version}\n`);
  // What the licenses folder names as this component's version.
  writeFileSync(
    path.join(RESOURCES_UUTILS_DIR, ".versions"),
    `${Object.entries(UPSTREAM)
      .map(([project, upstream]) => `${project} ${upstream}`)
      .join(", ")}\n`,
  );
  const total = readdirSync(RESOURCES_UUTILS_DIR)
    .map((name) => statSync(path.join(RESOURCES_UUTILS_DIR, name)).size)
    .reduce((sum, size) => sum + size, 0);
  console.log(
    `Vendored uutils (${target}) to ${RESOURCES_UUTILS_DIR}, ${(total / 1024 / 1024).toFixed(1)} MB`,
  );
}

await main();
