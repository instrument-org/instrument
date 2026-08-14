# ffmpeg and ffprobe come from a fork, pinned to a release candidate

Date: 2026-08-06

## Decision

`ffmpeg-ffprobe-static@7.1.0-rc.1` replaces `ffmpeg-static` and `@derhuerst/ffprobe-static`. One dependency ships both binaries, at ffmpeg 7.1.

The pin is exact rather than a range. It is a release candidate, from a fork, published in October 2024 and untouched since. All three of those are deliberate, and the reasons are below.

## Why not stay on ffmpeg-static

`ffmpeg-static@5.3.0` is its latest release and always will be, as far as the binaries go. Its `binary-release-tag` is `b6.1.1`, and the darwin-arm64 asset in that tag reports `ffmpeg version 6.0`. The repository has never published a 7.x release. Upgrading the dependency does nothing, which is the first thing anyone revisiting this will try.

The two-package split was itself a symptom: ffmpeg-static ships no ffprobe, so a second package had to supply one, and the two versions were free to drift.

## Why 7.1 specifically

7.1 added HEIF/HEIC to the `mov,mp4,...` demuxer's extension list. Before it, an iPhone photo is an unrecognized container that fails with `moov atom not found`, and everything downstream treats it as a corrupt file: an attached photo is dropped from the conversation with a note saying it is not readable, `read_file` cannot show it, and `generate_image` cannot use it as a reference.

That was not a theoretical gap. It reached a user as `[OpenAI] Invalid image file or mode for image 2`, a provider error naming the offending image by position and nothing else.

HEIC also needs a **seekable** input, which a pipe is not. Getting the version was half the fix; see the commit `workspace: give ffmpeg a file to seek in, not a pipe`.

## What the fork is

`ffmpeg-ffprobe-static` is Descript's fork of `ffmpeg-static`. It uses the same install mechanism, honors the same environment overrides, and carries the same GPL-3.0 license.

Its macOS binaries are repackaged osxexperts.net builds, which is the same upstream `ffmpeg-static` uses for macOS. Adopting it adds no new party to trust; it adds a party who cut a 7.x release.

Assets cover darwin arm64/x64, linux arm64/x64, and win32 x64. That is every target Studio builds for, and the same coverage `ffmpeg-static` gave: neither publishes win32-arm64 or anything 32-bit. The package's `index.js` claims linux ia32/arm and win32 ia32 support, but no assets exist for them, so on those platforms it returns a path to a file that is not there rather than `null`. Not a regression, and not a target we ship.

The binary grew from 45.5 MB to 49 MB.

## Why an rc is acceptable here

`7.1.0-rc.1` is the newest tag the fork published. It was never promoted to stable, and the package's `latest` dist-tag still points at `6.1.2-rc.1`. The open pull requests are 2024-or-older housekeeping. The most likely explanation is that they cut it and moved on.

What makes this tolerable is that the thing being pinned is a binary, not a library. There is no API to break under us, no transitive dependency to resolve, and no runtime behavior that a patch release would change. The binary either runs and reports 7.1 or it does not, and packaging now asserts exactly that (`studio: verify the packaged ffmpeg and ffprobe`), including a major-version floor, so a silent downgrade fails the build rather than shipping.

The pin is exact because a range across a package with prerelease tags could resolve somewhere nobody chose.

## Alternatives weighed

**Vendor per-platform, the way `uv` is vendored.** The machinery already exists: `scripts/download-uv.ts` into `resources/`, unpacked via `asarUnpack`, verified in `afterPack`. BtbN/FFmpeg-Builds covers linux x64/arm64 and win x64 with maintained, checksummed, current releases. macOS is the problem: it would come from osxexperts.net, a single maintainer with no API and no published checksums, which is a worse supply chain than an npm package with an integrity hash, for the same underlying build.

**Build ffmpeg ourselves in CI.** Real work, a permanent maintenance surface, and a macOS runner in the release path. Not warranted to move one version.

**Stay on 6.0 and solve HEIC elsewhere.** `sips` covers macOS with no new binary and nothing else anywhere, and it cannot help Windows or Linux users at all. It also leaves every other four-year-old ffmpeg bug in place.

## What would move us off this

- The fork promotes a stable 7.x or ships 8.x. Take it.
- The fork stays dead and we want something newer than 7.1. At that point vendoring per-platform is the honest answer, and the macOS source problem has to be solved rather than deferred.
- A maintained package appears that ships current ffmpeg **and** ffprobe for all five of our targets. Prefer it.
