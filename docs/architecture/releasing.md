# Releasing

Where a build comes from and where it goes. [auto-updater.md](auto-updater.md) is the consumer side of the same pipeline: this doc ends where that feed begins.

## Cutting one

`pnpm tag:release:patch` from `apps/studio`, or `:minor`, each with a `:beta` variant, runs [`tag-release.ts`](../../apps/studio/scripts/tag-release.ts). It fetches tags, verifies the `registry` submodule has nothing newer on its remote (the pointer a tag captures is the bundled content that ships), bumps `apps/studio/package.json`, commits `release: vX.Y.Z` with that file alone staged, and tags it. Nothing is pushed. Push `main` and the tag yourself; the tag is what starts the build.

## What the tag starts

[`release.yml`](../../.github/workflows/release.yml) matches `v*.*.*` and fans out over five targets: Linux x64 and arm64, Windows x64, macOS x64 and arm64. Prereleases skip Intel macOS, because electron-builder cannot express a custom update channel there and the resulting metadata would break auto-update for those users. The matrix deliberately does not fail fast: a leg left to finish keeps its artifacts across re-runs, while a canceled one has to be rebuilt. Publishing is gated on the matrix as a whole and on the smoke tests.

## Where the artifacts go

To S3, not to the GitHub release. The publish job syncs the installers and the electron-updater manifests (`latest.yml`, `latest-mac.yml`, `latest-linux*.yml`, and the channel variants) into the `instrument-releases` bucket named in [`electron-builder.ts`](../../apps/studio/electron-builder.ts), at the endpoint held in the `BUILDER_PUBLISH_S3_ENDPOINT` repository variable.

A release therefore carries zero attached assets. That is the normal shape, not an upload that failed.

## The draft, and why the build is already live

That sync is the release. Once the manifests land, every running app can see the new version and will offer it.

A stable release is created as a draft anyway, because the GitHub release exists for the notes rather than the bits. A draft is invisible to the unauthenticated GitHub API, and the app reads release bodies back through it to show the changelog for the build someone is running, so the notes reach users only once the draft is published. Publishing is not what ships the build, and leaving it drafted holds nothing back except the notes.

Prereleases are published immediately for the same reason read the other way: beta users need the notes, and `prerelease: true` keeps them off the "Latest" badge and lets stable clients filter them out.

## The notes

The generated body is a commit list standing in for real notes. Replace it wholesale with output from the `release-notes` skill: a one-line summary, then bullets grouped by product area. Read the previous few published releases for the register.

That generated body also grows a `Skills` section when the registry submodule pointer moved since the previous tag, which is the quickest cue for what bundled content changed.
