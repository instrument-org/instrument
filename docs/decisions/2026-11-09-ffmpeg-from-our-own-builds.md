# ffmpeg comes from our own builds

Date: 2026-11-09

Supersedes [ffmpeg and ffprobe come from a fork, pinned to a release candidate](2026-08-06-ffmpeg-from-a-fork-at-a-release-candidate.md).

## Decision

ffmpeg and ffprobe come from [instrument-org/ffmpeg-build](https://github.com/instrument-org/ffmpeg-build), a repository of ours that builds a pinned FFmpeg release for every platform Studio ships and publishes each build as a GitHub release. `apps/studio/scripts/download-ffmpeg.ts` vendors the one for the build's target into `resources/ffmpeg/`, checked against the hashes in `electron-builder/ffmpeg-release.ts`, the same way uv and uutils arrive. The npm package `ffmpeg-ffprobe-static` and our patch to it are gone.

The builds are GPL, with every codec library that license allows (x264 and x265 among them) and nothing from `--enable-nonfree`, except the few that another library in the build covers: libaom and rav1e (SVT-AV1 encodes AV1 and AVIF, dav1d decodes it) and openh264 (x264). The macOS builds also leave out Vulkan and libplacebo, which need a driver Macs do not have; VideoToolbox, Apple's hardware encoders, stays. That takes about a fifth off each Mac binary and loses no format.

The agent's `ffmpeg` skill is a system skill (`packages/workspace/system-skills/ffmpeg/`), not a registry one, since it describes this build: its encoders, the hardware ones, and how FFmpeg 9 reads a tiled HEIC photo. A test holds the version it names to `FFMPEG_VERSION`.

## Why

- **Nobody could say how the macOS binary was built.** The fork repackaged osxexperts.net's Apple Silicon build, a one-person site with no published recipe, so the licenses README could name FFmpeg's source but not the build. Ours is built in public CI from pinned scripts, and the release names them.
- **The binary had stopped moving.** The fork's last release was 7.1.0-rc.1 in October 2024, and FFmpeg's fixes since, security fixes in its decoders included, never reached us. Every image and video the agent reads goes through ffmpeg, so its decoders see files nobody vetted.
- **Every packaged alternative carries the same builds.** The npm and PyPI ffmpeg packages all repackage the same hobbyist binaries or older ones, which the 2026-10-28 look at downloading ffmpeg on demand confirmed. Building it is the only way to choose the version and know the source.

## How the builds are made

- **Linux and Windows**: BtbN/FFmpeg-Builds' `gpl-shared` variant, which cross-compiles in Docker images carrying every codec library prebuilt. `versions.env` pins its commit and each image's digest, since the images' `latest` tags move daily. These build FFmpeg's `release/9.0` branch at a pinned commit, 9.0.2 plus the fixes since: the images' codec libraries are newer than the 9.0.2 tag compiles against (openapv 1.1), and BtbN builds the branch for the same reason. The two programs share FFmpeg's libraries, in `lib/` on Linux and beside them in `bin/` on Windows, so the pair weighs about one copy of FFmpeg rather than two. This adds Windows arm64, which the fork never had.
- **macOS**: markus-perl/ffmpeg-build-script, which builds each library from a tarball pinned by SHA-256 and links them statically, for macOS 11 and newer. Its one switch for GPL codecs also turns on nonfree and fdk-aac, so we carry a two-line patch that keeps the GPL half. If anything nonfree came back, FFmpeg's own configure would refuse the build, and the smoke test checks the build configuration too.
- Every archive is unpacked and run on its own platform before a release: version, build flags, an H.264 and HEVC encode, PNG, JPEG and WebP, and HEIC in the mov demuxer.

## Alternatives weighed

**LGPL builds.** They settle the GPL source-offer question entirely, but drop x264 and x265, which the agent reaches for whenever it makes a video. We run ffmpeg as a separate program, so GPL does not reach our own code; what it asks is that the binary's license and source be available, and owning the build is what makes the source answer exact.

**Download ffmpeg on first use.** Weighed on 2026-10-28 and turned down: ffmpeg re-encodes every large or HEIC image sent to a model, so a computer offline after install would send worse images, for a 15 to 25 MB saving in download.

**FFmpeg 8.1.** 9.0.2 is the newest release, and the macOS build script pins its libraries for 9.x.

## What would move us

- A new FFmpeg release: change `FFMPEG` in ffmpeg-build's `versions.env` (and the BtbN commit and image digests for a new minor), tag a release, then refresh `ffmpeg-release.ts`.
- The macOS build script going unmaintained: its recipe is a few hundred lines of shell over pinned tarballs, and a fork of it is the fallback.
