# Root causes of three weeks of fixes

**Status:** measured on 2026-10-12 over the commits from 2026-09-21 to then; open. Several categories have structural changes landed since (noted per row), and the counts are not re-measured.

What causes the bugs we fix, by mechanism rather than by where they land. Of the 1,924 commits in the window, 1,728 were read in full (all but `docs:`, `release:`, `chore: format` and wireframe-kit commits), with the diff where a body was thin. 595 of them (31%) repair a defect rather than add a feature. Each was coded by the mechanism that caused it, and the codes were merged into the categories below. A spot check of eight re-read bodies found all eight coded correctly. Readers' fix rates ran from 28% to 41% per chunk, so the line between fix and feature varies a little: treat counts within about 10% of each other as ties.

## Ranking

"Count" is commits whose main cause is the category; "any" adds commits where it is the secondary cause. "Prevented" estimates how many of the counted fixes the structural change would have made unnecessary.

| # | Category | Count | Share | Example | Structural change | Prevented |
|---|---|---|---|---|---|---|
| 1 | Unhandled edge case: empty input, first run, a refusal, odd input | 63 | 10.6% | 625d79272 | none general | ~5 |
| 2 | Main held red by a commit: an unused export after a refactor, a file left out of a commit, callers a rename missed, a stale snapshot, one fix landed twice by two agents | ~57 | 9.6% | 3d00e88d7 | an affected types, knip and tests gate at commit time | ~40 |
| 3 | One fact or rule kept in two places, or one action written once per host, and the copies drifted | ~52 (any ~67) | 8.7% | 392e7e9f8 | a single owning function with a table test | ~30 |
| 4 | A library, provider or third-party API behaved other than assumed | 49 (any 76) | 8.2% | 3873fe97c | recorded contract tests; running upstream's tests on a bump | ~10 |
| 5 | Prompt or tool text contradicts real behavior, or the model misreads it | 44 (any 53) | 7.4% | 08a03c716 | a test that every command, skill, flag or path named in prompt text resolves | ~14 |
| 6 | A rework or rename dropped behavior, mostly "resolved against the wrong record" (window, chat or task) | ~42 (rework any 76) | 7.1% | 31078c415 | a record-kind type that tells the window, a chat and a task apart | ~15 to 20 |
| 7 | Error classification and failure scope: an expected error reported as a fault, cleanup only on success, one bad entry failing a whole collection | 38 (any 47) | 6.4% | 7d6307eb1 | one table of expected and fault codes at the RPC boundary; parsing collections per entry; release in `finally` | ~20 |
| 8 | Layout, CSS and theme | ~38 | 6.4% | 7e91a62f7 | a z-index scale; little else | ~3 |
| 9 | UI logic other than drift | ~36 | 6.1% | 95ed28075 | none | ~0 |
| 10 | Async ordering: a read before a subscribe, a dropped buffer, credential refresh races, write ordering | 36 (any 55) | 6.1% | 7d3358019 | subscribe before reading; one token owner per provider; atomic message writes | ~15 |
| 11 | A cache not invalidated, or keyed without the version of what it holds (a file viewer or thumbnail keeping the first bytes of a file still being written) | 19 (any 25) | 3.2% | 9729b6eb2 | URLs for file bytes keyed by path and mtime; live routes in place of plain queries | ~10 |
| 12 | Platform difference | 18 (any 30) | 3.0% | 2fc52b179 | Linux and Windows CI legs | ~4 |
| 13 | Release and packaging | ~17 | 2.9% | 95892da6f | none; smoke tests already catch them | ~0 |
| 14 | Electron guest and window lifecycle | 17 (any 36) | 2.9% | a8f95c4f1 | explicit guest entry phases; a teardown list per connection | ~6 |
| 15 | Virtual vs host path translation | 12 (any 19) | 2.0% | 0b1c31e9f | deleting the path bridge | ~15 incl. secondaries |
| 16 | React effect timing, React Compiler memoization included | 11 (any 19) | 1.8% | 64bafd167 | pure reducers for the state that races | ~3 |
| 17 | Real test flakes: load timing, fixed sleeps | ~11 | 1.8% | 962577306 | fake timers; no timeout equal to the code's own delay | ~5 |

About 25 more spread across small codes: resource cleanup 9, schema 6, main-thread blocking 3, a name collision 3, a missing permission check 2, a secret in a log 1, and others.

## What the ranking says

- About 40% of fixes (categories 1, 8, 9, most of 4 and 12, and 13, plus prompt behavior tuned by prose) are churn with no structural fix: new features meeting new edge cases.
- The largest preventable class is not in the app at all (category 2): concurrent agents leaving main red for each other.
- The longest single chain is category 3: "is the chat working, and on what step" took nine fixes before one pure function owned the rule (392e7e9f8).
- Neither Result library nor radashi was a meaningful source: radashi none, neverthrow two (both lint interactions), typescript-result one. The libraries behind fixes were just-bash (about 12), TanStack Query (4), Sonner (3), and a handful of others.

## What has landed against it since

- Category 2: `scripts/land.sh` lands a worktree branch only after affected types, lint, knip and related tests pass, and the format hook now covers files written from the shell.
- Category 3: one owner each for the chat's state, its own session, the session layout, the per-tab surface and the loopback sign-in.
- Category 7: Studio main's RPC interceptor classifies every error code from one table, with a test that fails on any code missing from it.
- Category 10: message writes are one transaction; the live transcript reads one change feed.
- Category 15: the agent works at real host paths, and the bridge is gone.

Still open: a test that names in prompt text exist (5), and versioned keys for file bytes everywhere a viewer reads them (11). Category 6 needed no type of its own: re-measured on 2026-10-19, none of the 845 commits since 2026-10-13 fixed a read of the wrong record, and the window, the record most often mistaken for a chat, no longer has a record folder, so the chat readers and writers refuse its id.
