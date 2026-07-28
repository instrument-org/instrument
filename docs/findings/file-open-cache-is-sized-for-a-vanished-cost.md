# The file-open cache is sized for a cost that no longer exists

**Status:** open. Known, deliberate, not yet re-derived. Recorded 2026-07-28.

## Context

Native file-open resolution ([file-open-target/](../../apps/studio/src/electron-main/lib/file-open-target/)) keeps three persisted caches with separate TTLs and size bounds, throttles helper processes to two at a time, and warms sixteen common extensions at startup. That is a lot of machinery, and a reader is likely to assume the numbers behind it were measured. They were not, or rather they were measured against a problem that got fixed five days later and nobody went back.

Recorded here because the numbers look deliberate in the code and the evidence that they are stale lives only in commit ordering.

## What we found

**Persistence predates the fix it was sized against.**

- `73c9fd4c2` (Jul 15 2026) added the persisted candidate cache, its TTLs, and its size bounds.
- `072ef5c81` (Jul 20 2026) fixed what they were defending against: every app icon rendered at native 1024px inside one interpreter, "~2.9s and 19MB of base64 per file type," with concurrent lookups running into the 10s timeout. Keying icons by app path and compositing into a 128px canvas collapsed that cost.

Nothing was removed or retuned afterward. `TARGET_CACHE_TTL_MS`, `CANDIDATE_CACHE_TTL_MS`, `ICON_CACHE_TTL_MS`, `MAX_PERSISTED_*`, `MAX_CANDIDATES`, `MAX_CONCURRENT_LOOKUPS`, and `LOOKUP_TIMEOUT_MS` are all inherited. `MAX_CONCURRENT_LOOKUPS = 2` is the clearest case: it was set in `072ef5c81` itself, and its comment describes the pre-fix behavior that same commit removed.

**What the post-fix cost actually is.** Production `DARWIN_CANDIDATES_SCRIPT` and `DARWIN_ICONS_SCRIPT`, unmodified, on one developer machine with ~180 apps installed, warm:

| Operation                                               | Cost                                |
| ------------------------------------------------------- | ----------------------------------- |
| `osascript -l JavaScript` bare startup                  | 10ms                                |
| Candidate enumeration, one extension                    | 60-130ms (first call 2x subsequent) |
| Candidate enumeration, 10 extensions sequential         | 640ms wall                          |
| Candidate enumeration, 10 extensions unbounded parallel | 280ms wall, 295% CPU                |
| Icon render, 15 apps, one interpreter                   | 130-160ms, ~50KB base64             |

A completely cold resolution of every common file type is under a second, and it is already deduplicated per extension in memory. That is enough to make the machinery look disproportionate and not enough to act on: one machine, warm, Apple Silicon.

## What might resolve it later

Cheap wins, each gated on re-measuring first:

- **Share one Launch Services pass between the two lookups.** A cold file runs `DARWIN_RESOLVE_SCRIPT` and `DARWIN_CANDIDATES_SCRIPT` separately, and the candidates script already computes the default path.
- **Batch startup warming.** `warmCommonFileOpenTargets` loops sixteen extensions sequentially at up to three processes each, roughly 35 spawns, holding lookup slots throughout.
- **Raise or remove `MAX_CONCURRENT_LOOKUPS`.** Unbounded fan-out across ten extensions now beats the cap of two by better than 2x.
- **Rank before capping.** The default app is protected from `MAX_CANDIDATES` (`574ee9a0e`), but everything else is still first-sixteen-by-OS-order, so a heavily associated type can lose a real app to ordering alone. Reordering what the OS returned is a product change to menu order and needs review; inventing associations is not on the table.
- **`CANDIDATE_SCAN_LIMIT` has the gap the menu cap used to have.** Enumeration stops after 64 apps, so a default ranked beyond that never reaches curation at all. It needs a file type with more than 64 handlers whose default sorts last, which nothing measured here approaches, and the fix would live in JXA that the mocked script boundary cannot test.

The larger question: **whether the persisted tier should exist.** Deleting it would remove the three maps, `CACHE_VERSION`, the persistence schemas, `trimToNewest`, and the debounced writer, along with the whole class of bug where a stale persisted entry outlives the code that wrote it. The decomposition in `fa9fb857e` made that a small, reversible change rather than a rewrite. Before doing it, measure first-open latency on a cold Launch Services database, on Intel, and with a much larger `/Applications`, and compare against the same measurement with warming batched. If warming after first window render covers it on the worst machine measured, the tier can go. The content-addressed PNG store stays either way: it is an asset store, not a cache index, and re-rendering an app icon yields the same bytes and the same URL.

## Guardrails

- **Do not replace JXA with a native Launch Services helper** without evidence of persistent latency or reliability problems. A comparable desktop app ships one, but it costs architecture-specific builds, packaging, signing, and release validation.
- **Curation policy must stay editable without a cache version bump.** Candidate lists are persisted raw and curated on read for exactly this reason.

## Related

- [preview-app-declares-no-text-types.md](./preview-app-declares-no-text-types.md): why Preview is offered for some types and not others
- `fa9fb857e`, `574ee9a0e`, `ea95e5750`: the decomposition that made these questions answerable
