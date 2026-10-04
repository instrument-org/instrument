# Releasing

Where a build comes from and where it goes. [auto-updater.md](auto-updater.md) is the consumer side of the same pipeline: this doc ends where that feed begins.

## Cutting one

`pnpm tag:release:patch` from `apps/studio`, or `:minor`, each with a `:beta` variant, runs [`tag-release.ts`](../../apps/studio/scripts/tag-release.ts). It fetches tags, verifies the `registry` submodule has nothing newer on its remote (the pointer a tag captures is the bundled content that ships), bumps `apps/studio/package.json`, stages that file, commits `release: vX.Y.Z`, and tags it. The commit takes the whole index, so anything already staged rides along: start from an empty index. Nothing is pushed. Push `main` and the tag yourself; the tag is what starts the build.

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

The notes travel in the tag. `tag-release.ts --notes <file>` makes them the annotated tag's message, written with the `release-notes` skill before tagging: a one-line summary, then bullets grouped by product area, each led by one short sentence. The publish job reads that message back and uses it twice:

- **Slack** gets the summary line and the lead sentence of the first two bullets in each section, with a link to the release. [`release-summary.ts`](../../apps/studio/scripts/release-summary.ts) does the cutting, deterministically and with no model, which is why the leads have to stand on their own.
- **The release body** is the notes followed by the compare links, and is what the app shows as the changelog.

The job re-fetches the tag before reading it, because `actions/checkout` rewrites a pushed annotated tag as a lightweight one and the message would read as empty.

A tag cut without notes still ships. Slack then gets the range's commits grouped by scope with the plumbing scopes (`dx`, `docs`, `lint` and the like) dropped, and the body is the commit list, with a `Skills` section when the registry pointer moved.

The range starts at the last published release, so a tag whose build failed folds into the next one. Its notes have to as well: the next tag's notes cover everything since the last release anyone could install.
