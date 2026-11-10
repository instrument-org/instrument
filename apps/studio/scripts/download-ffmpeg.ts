// Vendors ffmpeg and ffprobe into `resources/ffmpeg/` so they ship in the
// signed `app.asar.unpacked` tree beside uv. Every image and video the agent
// reads goes through them, and so do its `ffmpeg`/`ffprobe` commands. The
// archives come from instrument-org/ffmpeg-build, which builds the FFmpeg
// release named below, GPL with nonfree left out, for every target Studio
// ships. Downloads the archive for the build's target, checks it and what it
// unpacks to against the hashes in electron-builder/ffmpeg-release.ts, and
// keeps the archive's tree:
// `bin/` (with FFmpeg's DLLs on Windows), `lib/` on Linux, and `licenses/`.
// Run from dev setup and before every package build (see
// apps/studio/package.json `ffmpeg:download`).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  FFMPEG_RELEASE,
  FFMPEG_SHA256,
  ffmpegTarget,
  ffmpegTreeSha256,
} from "../electron-builder/ffmpeg-release.ts";

const RESOURCES_FFMPEG_DIR = path.resolve(
  import.meta.dirname,
  "../resources/ffmpeg",
);

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
 * Extract an archive into `dir`. On Windows the `tar` on PATH is often Git's
 * GNU tar, which cannot read a zip and parses `D:\...` as a remote host, so a
 * zip goes through PowerShell there.
 */
function extractArchive(archivePath: string, dir: string) {
  if (archivePath.endsWith(".zip") && process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${dir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("tar", ["-xf", archivePath, "-C", dir], { stdio: "inherit" });
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Honor electron-builder's ARCH convention so a cross-arch package build
// vendors the right binaries, and a TARGET_PLATFORM override as download-uv.ts
// does; fall back to the host otherwise.
function resolveTarget() {
  return ffmpegTarget(
    process.env.TARGET_PLATFORM ?? process.platform,
    process.env.ARCH ?? process.arch,
  );
}

async function main() {
  const target = resolveTarget();
  const pinned = FFMPEG_SHA256[target];
  const exe = target.startsWith("win32-") ? ".exe" : "";
  const marker = path.join(RESOURCES_FFMPEG_DIR, ".version");
  const version = `${FFMPEG_RELEASE} ${target} ${pinned.archive.slice(0, 12)}`;
  if (
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version &&
    existsSync(path.join(RESOURCES_FFMPEG_DIR, "bin", `ffmpeg${exe}`))
  ) {
    console.log(`ffmpeg (${target}) already vendored, skipping.`);
    return;
  }

  const asset = `ffmpeg-${target}${exe ? ".zip" : ".tar.gz"}`;
  const url = `https://github.com/instrument-org/ffmpeg-build/releases/download/${FFMPEG_RELEASE}/${asset}`;
  console.log(`Downloading ${asset}...`);
  const bytes = await fetchBuffer(url);
  const actual = sha256(bytes);
  if (actual !== pinned.archive) {
    throw new Error(
      `Checksum mismatch for ${asset}: expected ${pinned.archive}, got ${actual}`,
    );
  }

  rmSync(RESOURCES_FFMPEG_DIR, { force: true, recursive: true });
  mkdirSync(RESOURCES_FFMPEG_DIR, { recursive: true });
  const archivePath = path.join(RESOURCES_FFMPEG_DIR, asset);
  writeFileSync(archivePath, bytes);
  try {
    extractArchive(archivePath, RESOURCES_FFMPEG_DIR);
  } finally {
    rmSync(archivePath, { force: true });
  }
  const tree = ffmpegTreeSha256(RESOURCES_FFMPEG_DIR);
  if (tree !== pinned.tree) {
    throw new Error(
      `Checksum mismatch for what ${asset} unpacks to: expected ${pinned.tree}, got ${tree}`,
    );
  }
  writeFileSync(marker, `${version}\n`);
  console.log(`Vendored ffmpeg (${target}) to ${RESOURCES_FFMPEG_DIR}`);
}

await main();
