// Vendors Cua Driver's `cua-driver` executable into `resources/cua-driver/` so
// it ships in the signed `app.asar.unpacked` tree beside `uv`. Studio starts it
// as a direct child of the main process (`lib/computer-driver.ts`), which is
// what lets it work under this app's Accessibility and Screen Recording grants
// on macOS. The `@trycua/cua-driver` npm package carries only the SDK that
// starts and talks to it, so the executable comes from the matching GitHub
// release, checksum-verified. Keep CUA_DRIVER_VERSION equal to that package's
// version: the SDK and the daemon speak one contract version.

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

const CUA_DRIVER_VERSION = "0.33.4";

const RESOURCES_DIR = path.resolve(
  import.meta.dirname,
  "../resources/cua-driver",
);

type NodeArch = "arm64" | "x64";
type NodePlatform = "darwin" | "linux" | "win32";

// The `-binary` archives hold the bare executables. macOS has one universal
// build; Windows also needs the UI Automation helper the driver spawns.
const TARGETS: Record<
  NodePlatform,
  Record<NodeArch, { asset: string; files: string[] }>
> = {
  darwin: {
    arm64: { asset: "darwin-universal-binary.tar.gz", files: ["cua-driver"] },
    x64: { asset: "darwin-universal-binary.tar.gz", files: ["cua-driver"] },
  },
  linux: {
    arm64: { asset: "linux-arm64-binary.tar.gz", files: ["cua-driver"] },
    x64: { asset: "linux-x86_64-binary.tar.gz", files: ["cua-driver"] },
  },
  win32: {
    arm64: {
      asset: "windows-arm64-binary.zip",
      files: ["cua-driver.exe", "cua-driver-uia.exe"],
    },
    x64: {
      asset: "windows-x86_64-binary.zip",
      files: ["cua-driver.exe", "cua-driver-uia.exe"],
    },
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

async function main() {
  const platform = resolvePlatform();
  const arch = resolveArch();
  const target = TARGETS[platform][arch];
  const asset = `cua-driver-rs-${CUA_DRIVER_VERSION}-${target.asset}`;
  const versionMarker = path.join(RESOURCES_DIR, ".version");
  const stamp = `${CUA_DRIVER_VERSION}-${target.asset}`;

  const cached = existsSync(versionMarker)
    ? readFileSync(versionMarker, "utf8").trim()
    : undefined;
  if (
    cached === stamp &&
    target.files.every((file) => existsSync(path.join(RESOURCES_DIR, file)))
  ) {
    console.log(`cua-driver ${stamp} already vendored, skipping.`);
    return;
  }

  const baseUrl = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_DRIVER_VERSION}`;
  console.log(`Downloading ${asset}...`);
  const [archive, checksums] = await Promise.all([
    fetchBuffer(`${baseUrl}/${asset}`),
    fetchBuffer(`${baseUrl}/checksums.txt`).then((b) => b.toString("utf8")),
  ]);

  const expected = findChecksum(checksums, asset);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`,
    );
  }

  const extractDir = mkdtempSync(path.join(tmpdir(), "cua-driver-download-"));
  try {
    writeFileSync(path.join(extractDir, asset), archive);
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
    } else {
      execFileSync("tar", ["-xf", asset], {
        cwd: extractDir,
        stdio: "inherit",
      });
    }

    rmSync(RESOURCES_DIR, { force: true, recursive: true });
    mkdirSync(RESOURCES_DIR, { recursive: true });
    for (const file of target.files) {
      const dest = path.join(RESOURCES_DIR, file);
      copyFileSync(path.join(extractDir, file), dest);
      if (platform !== "win32") {
        chmodSync(dest, 0o755);
      }
    }
    writeFileSync(versionMarker, `${stamp}\n`);
    console.log(`Vendored cua-driver ${stamp} to ${RESOURCES_DIR}`);
  } finally {
    rmSync(extractDir, { force: true, recursive: true });
  }
}

// `checksums.txt` is Markdown wrapping `"<hex>  <filename>"` lines.
function findChecksum(text: string, asset: string): string {
  for (const line of text.split("\n")) {
    const [hex, name] = line.trim().split(/\s+/);
    if (name === asset && hex && /^[0-9a-f]{64}$/i.test(hex)) {
      return hex.toLowerCase();
    }
  }
  throw new Error(`No checksum for ${asset} in checksums.txt`);
}

// Same ARCH and TARGET_PLATFORM overrides as download-uv.ts, so a cross-arch
// or cross-platform package build vendors the right executable.
function resolveArch(): NodeArch {
  const arch = process.env.ARCH ?? process.arch;
  if (arch === "arm64" || arch === "x64") {
    return arch;
  }
  throw new Error(`Unsupported architecture for cua-driver: ${arch}`);
}

function resolvePlatform(): NodePlatform {
  const platform = process.env.TARGET_PLATFORM ?? process.platform;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`Unsupported platform for cua-driver: ${platform}`);
}

await main();
