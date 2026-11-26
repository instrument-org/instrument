# Plan: a cache folder every chat can write without asking

Status: dropped. Not built: the gap it set out to close is mostly not there. Kept so the idea is not proposed again on the same premise; if a skill comes to need a cache, start from "If it comes back" below.

## The proposal

One app-owned folder per computer, `~/.instrument/cache/` beside the chats' work folders, named to every shell as `$INSTRUMENT_CACHE`, open to every chat without a card. Skills and project kits would keep there what is expensive to make and cheap to make again (snapshots, downloaded models, a built index), one subfolder per owner, trimmed by age and size at launch.

## Why it was dropped

Each reason it gave was checked against the code and against real use:

- **"Writing to the platform caches raises a card."** Not on macOS or Linux: `~/Library/Caches` and `~/.cache` are open to read and write unless the person sets the app-files place to Not allowed (`openUnlessClosed` in `packages/workspace/src/lib/permissions/places.ts`, made rules in `packages/workspace/src/lib/permissions/rules.ts`). Only Windows asks, since all of `AppData` is the app-files place there.
- **"The work folder does not survive the chat."** It is removed only when the chat comes to rest with nothing in it (`packages/workspace/src/lib/chat/work-dir-reap.ts`). It is per chat, which matters only if something is worth sharing between chats.
- **"Skills keep expensive things between chats."** No shipped skill does: nothing in the registry writes a cache of its own; the only cache paths it names are where it looks for a browser already downloaded.
- **"Chats redo expensive downloads."** Across about 1,360 chats in the workspaces of two development machines, no repository was cloned twice and one chat downloaded a model. The reuse that does matter, Python and npm packages, is already shared by every chat through uv's cache and the pnpm store in the runtime folder (`runtimeLayout` in `packages/workspace/src/lib/runtime-dir.ts`).
- **The incident behind it**, a snapshot library rewriting hundreds of files in a synced folder, happened in an agent outside the app, where `$INSTRUMENT_CACHE` would not exist, and was fixed by keeping the library in its repository checkout.

Trimming was dropped with it. The runtime folder's caches had almost nothing untouched for 30 days on either machine, and macOS does not update a file's access time on read, so an age rule could only go by when a file last changed and would delete a model still in daily use.

## What stays open

- On Windows, a skill that keeps a cache in `%LOCALAPPDATA%` raises an app-files card.
- Model downloads on macOS and Linux go to `~/.cache` (`modelCachesEnvFor` in `packages/workspace/src/lib/tool-isolation-env.ts`), so they fail while the app-files place is Not allowed. Windows points them at the runtime folder's caches instead.

Neither has been reported. Fix the one that is.

## If it comes back

What came out of working the design through, for when a skill does need a cache:

- Point Hugging Face's downloads with `HF_HUB_CACHE`, not `HF_HOME`: `HF_HOME` also moves where the person's sign-in token is read, and gated models stop downloading.
- Playwright and Go keep their caches under `~/Library/Caches/<their own>` on macOS whatever `XDG_CACHE_HOME` says.
- Trim by size first (oldest change first past a cap), with a long age limit, not a short age limit alone.
- The folder should read as safe to delete to a person who finds it large; the platform cache folder named for the app does, a folder inside Application Support does not.
