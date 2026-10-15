// Vendors uutils (MIT-licensed Rust reimplementations of the GNU text tools)
// into `resources/uutils/` so they ship in the signed `app.asar.unpacked` tree
// beside uv, and the agent's shell runs GNU-compatible `sort`, `find`, `grep`
// and the rest natively on every platform. Downloads each pinned release
// archive for the build's target, checks it against the hash pinned here, and
// keeps only the binaries the shell runs. Run from dev setup and before every
// package build (see apps/studio/package.json `uutils:download`).

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

/**
 * One release archive and the binaries kept from it. `binaries` are base
 * names without `.exe`, found anywhere in the archive and written under the
 * same name.
 */
interface Archive {
  asset: string;
  binaries: string[];
  repo: string;
  sha256: string;
  tag: string;
}

const COREUTILS = { repo: "uutils/coreutils", tag: "0.12.0" };
const FINDUTILS = { repo: "uutils/findutils", tag: "0.10.0" };
const DIFFUTILS = { repo: "uutils/diffutils", tag: "v0.5.0" };
const GREP = { repo: "uutils/grep", tag: "0.2.0" };

/**
 * Every archive per target, by its sha256 as published. Linux takes the musl
 * builds where they exist (coreutils, findutils), which run on any
 * distribution; diffutils and grep publish only glibc builds, which need
 * glibc 2.34 or later. Windows on ARM gets coreutils alone, the only one of
 * the four with a build for it; the commands the others answer stay the
 * shell's own there.
 */
const ARCHIVES: Record<Target, Archive[]> = {
  "darwin-arm64": [
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-aarch64-apple-darwin.tar.gz",
      binaries: ["coreutils"],
      sha256:
        "7caea447564405b3eb50cce2a89d314df07d1b7a67090dc4cc7c82eba7014052",
    },
    {
      ...FINDUTILS,
      asset: "findutils-aarch64-apple-darwin.tar.xz",
      binaries: ["find", "xargs"],
      sha256:
        "f2f7a6071f6b321f62d54f2e9303a3bd18c348fdc5464253e4f24ac3bfc55b04",
    },
    {
      ...DIFFUTILS,
      asset: "diffutils-aarch64-apple-darwin.tar.xz",
      binaries: ["diffutils"],
      sha256:
        "0c164e83d59fbbc23b93003d446ff7de228b8f81c64f08b1ef1f5ad1cee1b347",
    },
    {
      ...GREP,
      asset: "uu_grep-aarch64-apple-darwin.tar.xz",
      binaries: ["grep"],
      sha256:
        "f81be982ab1b4e268e4243d1aad8fba217df5c110531f3516304c77cbf371128",
    },
  ],
  "darwin-x64": [
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-x86_64-apple-darwin.tar.gz",
      binaries: ["coreutils"],
      sha256:
        "a845b274f91c23b779f097e15045f4bf7cbcf99d6e62e6878d9db816e6887586",
    },
    {
      ...FINDUTILS,
      asset: "findutils-x86_64-apple-darwin.tar.xz",
      binaries: ["find", "xargs"],
      sha256:
        "d74273aab28e95c253570e3f1958387dc98e2b73f569674c30173d78876fb50b",
    },
    {
      ...DIFFUTILS,
      asset: "diffutils-x86_64-apple-darwin.tar.xz",
      binaries: ["diffutils"],
      sha256:
        "fc11327f89f624a254b9c1828aedc5c35c472450915280497c8f627f3561f370",
    },
    {
      ...GREP,
      asset: "uu_grep-x86_64-apple-darwin.tar.xz",
      binaries: ["grep"],
      sha256:
        "146a9dfd104ca54d8349838369cb4a4779a63a9dc0efefdd6ab84230999f5728",
    },
  ],
  "linux-arm64": [
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-aarch64-unknown-linux-musl.tar.gz",
      binaries: ["coreutils"],
      sha256:
        "614a0224ea49f85020cfc30ca980599965fa8501131f9588db4fa41c125a7805",
    },
    {
      ...FINDUTILS,
      asset: "findutils-aarch64-unknown-linux-musl.tar.xz",
      binaries: ["find", "xargs"],
      sha256:
        "c2dad7fbf0cd6b108f833b0a42651f3ad796b6dfa71d303ca1ab51eed3ce3afe",
    },
    {
      ...DIFFUTILS,
      asset: "diffutils-aarch64-unknown-linux-gnu.tar.xz",
      binaries: ["diffutils"],
      sha256:
        "d6249274d4e1569b37c6b1d7f68418824d99cacde31a55c72ddd65d3f8fd355c",
    },
    {
      ...GREP,
      asset: "uu_grep-aarch64-unknown-linux-gnu.tar.xz",
      binaries: ["grep"],
      sha256:
        "99d2d43ad4f648a6518ca7d65460de2a7a4ff0f2dbeecfb770cc06e0a406c68f",
    },
  ],
  "linux-x64": [
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-x86_64-unknown-linux-musl.tar.gz",
      binaries: ["coreutils"],
      sha256:
        "9b555b01457279bcc3e46753f0ef324fd3d02a0535111200a4632d1297263b54",
    },
    {
      ...FINDUTILS,
      asset: "findutils-x86_64-unknown-linux-musl.tar.xz",
      binaries: ["find", "xargs"],
      sha256:
        "e7c10ea19e1dce2549aaf6f35e15bf42a5e8141d6100c499b6d6fc9b25ea9209",
    },
    {
      ...DIFFUTILS,
      asset: "diffutils-x86_64-unknown-linux-gnu.tar.xz",
      binaries: ["diffutils"],
      sha256:
        "322e59ab837ecaf838c4511091615b01bf289030699133e45fa5843e53dfc32b",
    },
    {
      ...GREP,
      asset: "uu_grep-x86_64-unknown-linux-gnu.tar.xz",
      binaries: ["grep"],
      sha256:
        "7ffdf7ef9fee0fc07b6a389f14fad0b5236011cf1d08885ffe69f0831f2923e5",
    },
  ],
  "win32-arm64": [
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-aarch64-pc-windows-msvc.zip",
      binaries: ["coreutils"],
      sha256:
        "3ee5621c16ccb290ac3a419613afc14879f1e81db7cdb21a0034e32c71eec565",
    },
  ],
  "win32-x64": [
    // 67 MB: the zip carries every utility as a standalone .exe beside the
    // multicall one, which is all that is kept.
    {
      ...COREUTILS,
      asset: "coreutils-0.12.0-x86_64-pc-windows-msvc.zip",
      binaries: ["coreutils"],
      sha256:
        "45d6760c136ef42cdba1e2dbb492b0858be98099d6c7fb3e300a3adcfbc54cfe",
    },
    {
      ...FINDUTILS,
      asset: "findutils-x86_64-pc-windows-msvc.zip",
      binaries: ["find", "xargs"],
      sha256:
        "d056b1151f70fdb0c5e6ab216a153ac7161d84afc6764766a6ab92ab441d16fc",
    },
    {
      ...DIFFUTILS,
      asset: "diffutils-x86_64-pc-windows-msvc.zip",
      binaries: ["diffutils"],
      sha256:
        "36c900a06060ee31621fcdecb9bf223b40dd23d45e91ba98101b5d3aa5c70d18",
    },
    {
      ...GREP,
      asset: "uu_grep-x86_64-pc-windows-msvc.zip",
      binaries: ["grep"],
      sha256:
        "b364af18fb6367b41b6489a9d2f1e92c8fa80dc37af8aa4fece3293015f03871",
    },
  ],
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

async function vendor(archive: Archive, platform: NodePlatform) {
  const url = `https://github.com/${archive.repo}/releases/download/${archive.tag}/${archive.asset}`;
  console.log(`Downloading ${archive.asset}...`);
  const bytes = await fetchBuffer(url);
  const actual = sha256(bytes);
  if (actual !== archive.sha256) {
    throw new Error(
      `Checksum mismatch for ${archive.asset}: expected ${archive.sha256}, got ${actual}`,
    );
  }
  const extractDir = mkdtempSync(path.join(tmpdir(), "uutils-download-"));
  try {
    writeFileSync(path.join(extractDir, archive.asset), bytes);
    extractArchive(archive.asset, extractDir);
    for (const binary of archive.binaries) {
      const fileName = platform === "win32" ? `${binary}.exe` : binary;
      const found = findFile(extractDir, fileName);
      if (!found) {
        throw new Error(`Could not find ${fileName} in ${archive.asset}`);
      }
      const dest = path.join(RESOURCES_UUTILS_DIR, fileName);
      copyFileSync(found, dest);
      if (platform !== "win32") {
        chmodSync(dest, 0o755);
      }
    }
    const license =
      findFile(extractDir, "LICENSE") ?? findFile(extractDir, "LICENSE-MIT");
    if (license) {
      copyFileSync(
        license,
        path.join(
          RESOURCES_UUTILS_DIR,
          `LICENSE-${path.basename(archive.repo)}`,
        ),
      );
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
  const archives = ARCHIVES[target];
  const marker = path.join(RESOURCES_UUTILS_DIR, ".version");
  const version = `${target} ${archives.map((archive) => archive.sha256.slice(0, 12)).join(" ")}`;
  const vendored =
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version &&
    archives
      .flatMap((archive) => archive.binaries)
      .every((binary) =>
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
  for (const archive of archives) {
    await vendor(archive, platform);
  }
  writeFileSync(marker, `${version}\n`);
  const total = readdirSync(RESOURCES_UUTILS_DIR)
    .map((name) => statSync(path.join(RESOURCES_UUTILS_DIR, name)).size)
    .reduce((sum, size) => sum + size, 0);
  console.log(
    `Vendored uutils (${target}) to ${RESOURCES_UUTILS_DIR}, ${(total / 1024 / 1024).toFixed(1)} MB`,
  );
}

await main();
