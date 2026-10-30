# Plan: one Mac update feed for both architectures

Status: open. Not started. Nobody on an Intel Mac takes betas yet; do this before one does.

## Why Intel has its own channel

Each Mac architecture is packaged on its own runner (`release.yml`: `macos-26` for arm64, `macos-26-intel` for x64), and each leg writes its own `latest-mac.yml` (plus `beta-mac.yml` and `alpha-mac.yml`, from `generateUpdatesFilesForAllChannels`). Uploaded side by side, one would overwrite the other. The x64 leg avoids that by publishing to `${channel}-${arch}` (`mac.publish.channel` in `electron-builder.ts`), so x64 builds read `latest-x64-mac.yml` and `update.ts` pins every Intel install to `latest-x64` (`MACOS_INTEL_CHANNEL`). Prereleases skip the x64 leg (`SKIP_INTEL_MACOS`) rather than publish a feed that pin cannot reach.

electron-updater does not need the split. `MacUpdater.filterFilesForArch` reads one manifest listing both zips and picks by whether `arm64` appears in the file's URL: an Apple-silicon Mac takes the arm64 zip, including an x64 install running under Rosetta, and an Intel Mac takes the other. The limitation (electron-userland/electron-builder#5592) is only that two machines cannot write one manifest.

## The change

1. **Name each leg's manifests apart.** In the Mac legs, after packaging, rename `*-mac.yml` to `*-mac.<arch>.yml` before upload, so `download-artifact` with `merge-multiple` keeps both.
2. **Merge in the publish job.** For each channel file, write one `<channel>-mac.yml`: `version` and `releaseDate` from either (they match, or the merge fails), `files` as the union of both legs' entries, and the top-level `path` and `sha512` from the arm64 leg. Fail if a leg's file is missing or the versions differ. A small script beside `release-summary.ts`, with a test.
3. **Keep `latest-x64-mac.yml` for installs already pinned to it.** Write it as a copy of the merged `latest-mac.yml`. A pinned install reads it, updates to a build without the pin, and from then on reads the shared feed. Keep writing the copy for as long as an install from before this change might still open; it costs nothing.
4. **Drop the pin and the skip.** Remove `mac.publish.channel`, `SKIP_INTEL_MACOS` and its conditions, and `MACOS_INTEL_CHANNEL` with its branch in `getChannel`, then correct `releasing.md` and `auto-updater.md`.

## What it gets

- Intel Macs can take betas and alphas, like every other platform.
- An x64 install on an Apple-silicon Mac (from Migration Assistant, or the wrong download) updates itself to arm64, which makes `arm64-translation-warning.ts` close to moot on macOS.

## Checks

- Unit test the merge: both legs present, one missing, mismatched versions.
- Before the first stable release after this lands, cut a beta and read the published `beta-mac.yml`: two entries under `files`, each zip present in the bucket with a matching sha512.
- On the Intel test host, an install of the previous stable on `latest-x64` updates, and its next check reads `latest-mac.yml`.
