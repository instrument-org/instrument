# Releasing

Where a build comes from and where it goes. [auto-updater.md](auto-updater.md) is the consumer side of the same pipeline: this doc ends where that feed begins.

## Cutting one

`pnpm tag:release:patch` from `apps/studio`, or `:minor`, each with a `:beta` variant, runs [`tag-release.ts`](../../apps/studio/scripts/tag-release.ts). It fetches tags, verifies the `registry` submodule has nothing newer on its remote (the pointer a tag captures is the bundled content that ships), rebases the current branch onto origin's, bumps `apps/studio/package.json`, commits that file alone as `release: vX.Y.Z`, tags it, and pushes the branch and the tag in one atomic push; the tag is what starts the build. When origin moved in between, the push is rejected and the script deletes the unpushed tag, rebases the release commit, tags it again, and retries, so the branch never takes a merge commit and the tag is always on it. `--no-push` stops after tagging.

## What the tag starts

[`release.yml`](../../.github/workflows/release.yml) matches `v*.*.*` and fans out over five targets: Linux x64 and arm64, Windows x64, macOS x64 and arm64. Prereleases skip Intel macOS. Each Mac architecture builds on its own runner and writes its own update manifest, so the x64 leg publishes to a separate `latest-x64` channel rather than overwrite the arm64 one, and a prerelease feed that channel cannot reach would break auto-update for those users. [intel-mac-update-feed.md](../plans/active/intel-mac-update-feed.md) merges the two instead. The matrix deliberately does not fail fast: a leg left to finish keeps its artifacts across re-runs, while a canceled one has to be rebuilt. Each leg smoke tests the app it just packaged and signed, so what is tested is what ships, Intel included. Publishing is gated on the matrix as a whole. [`smoke-test.yml`](../../.github/workflows/smoke-test.yml) runs the same test on demand against an unsigned build of its own.

## Where the artifacts go

To S3, not to the GitHub release. The publish job syncs the installers and the electron-updater manifests (`latest.yml`, `latest-mac.yml`, `latest-linux*.yml`, and the channel variants) into the `instrument-releases` bucket named in [`electron-builder.ts`](../../apps/studio/electron-builder.ts), at the endpoint held in the `BUILDER_PUBLISH_S3_ENDPOINT` repository variable.

A release therefore carries zero attached assets. That is the normal shape, not an upload that failed.

### Windows: Velopack

Windows installs and updates through [Velopack](https://github.com/velopack/velopack), not electron-builder's NSIS installer. The Windows leg still runs electron-builder, which signs the app and leaves it unpacked in `win-unpacked/`, and then [`velopack-pack.ts`](../../apps/studio/scripts/velopack-pack.ts) packs that folder with `vpk`, once per channel the version is released on (a stable release on `latest`, `beta` and `alpha`; a beta on `beta` and `alpha`; an alpha on `alpha`, as electron-builder's update files are). For each channel it first downloads that channel's previous release from the feed, so the package comes with a delta from it, then writes the full package, the delta, the channel's `Instrument-<channel>-Setup.exe`, and `releases.<channel>.json`. `vpk` signs every executable in the package that is not signed already, Velopack's own `Update.exe` and launcher included, through the same cloud HSM (`--signTemplate` running [`win-sign-file.js`](../../apps/studio/electron-builder/win-sign-file.js)), and the leg's signature check covers the Setups too. `vpk` is the version of the `velopack` package the app loads, which the workflow reads from `apps/studio/package.json`, since the `Update.exe` a package carries is `vpk`'s and has to speak the SDK's protocol. The packages carry the app's `APP_BUNDLE_ID` as their shortcuts' AppUserModelID, which the app sets for itself and Windows matches toasts by.

The leg uploads them under `velopack/`, and the publish job syncs that folder to the bucket's `velopack/` with the rest, holding `releases.*.json` back with the `.yml` manifests until everything they name is there. `releases.<channel>.json` lists the releases in the folder the leg packed: the channel's previous release and this one. An app further behind finds no delta from its version and downloads the full package.

The NSIS installer and `latest.yml` are still built and published, for the move: an install made before Velopack updates through electron-updater to the newest NSIS build, and that build, finding itself installed by NSIS, moves to the Velopack install (`update-bridge.ts`, [auto-updater.md](auto-updater.md#windows-velopack)). Both keep the app's data under its product name in AppData, so nothing moves with it. The NSIS half can stop once no install older than the first Velopack release is left to update.

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
