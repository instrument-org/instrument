# Where coding agents lose time in this repo

**Status:** measured on 2026-10-12 over coding-agent sessions from 2026-09-28 to then; open. Findings 1 and 2 have changes landed since (noted below); the rest stand.

Where agents working on this repo waste effort or bring in bugs, read from their session transcripts. The sample was 292 main sessions and 461 subagent transcripts across the main checkout and its worktrees: 356,354 transcript events, 63,842 tool calls paired with their results, and 1,865 messages from the person running them. Counts below are measured from those pairings; anything marked "est." is a heuristic or a hand reading.

Of the 3,825 in-repo edits, 2,170 went through the Edit and Write tools and 1,655 through Bash (962 Python heredocs, 588 `sed -i`, 59 `cat >`, 46 `perl -i`), so a failure rate of the edit tools alone says little.

## Ranking

| # | Finding | Kind | Measure | Example of the shape | Change |
|---|---|---|---|---|---|
| 1 | Agents sharing one working tree | tooling | 124 transcripts say another agent's unfinished edits turned their checks red; of 303 failing type checks, 112 had no error in any file the session edited (an upper bound); 2,212 `git diff` runs on their own files to tell their work from others', 592 commits by path, 101 `git stash`, 28 pushes rejected because main had moved | a test file failing to load because of another session's half-written module | a worktree per editing session, a script that lands it after checks |
| 2 | Edits the format and lint hook never saw | tooling | 1,655 of 3,825 edits (43%) went through Bash, which the hook did not track; at least 4 corrections asked for leftover formatting to be fixed | a heredoc rewrite committed unformatted | the hook records files a Bash command writes and names |
| 3 | Waiting with `sleep` | tooling | 1,552 `sleep` calls, about 40 hours: eval runs 442 calls (12.2 h), background output files 280 (13.6 h), CI 167 (6.6 h), the app 361 (1.6 h). Est.: the real cost is turns and context re-reading partial output | polling an eval's results file every 30 seconds | `eval --wait` and a CI wait wrapper; the skills say to run in the background and wait for the notification |
| 4 | Chat, task, session and path concepts with no single owner | product code | "property does not exist" on `taskId` 49 times, `sessionId` 15, `parentTaskId` 14, `chatId` 10; "no exported member" 202 times after moves; 1,925 searches with four or more alternative names, the commonest words task 583, chat 380, open 225, folder 224, path 168, session 164 | searching six spellings for "the tasks of a chat" | one owner for chat and task relations, a record-kind type, one host-path module, a concept-to-module glossary |
| 5 | Giant hot files | product code | the Finder page (2,833 lines) read 113 times in 21 sessions and edited 32 times; the file system view (6,658 lines) read 66 times; the `app` command (1,192 lines) took six or more edits in a row in 3 sessions; the bash env builder's test failed in 8 sessions | reading a 6,000-line file in `sed -n` slices | split by concern |
| 6 | Snapshot tests over prompt text | test structure | 60 runs failed on snapshot mismatch, led by the LLM request logic (17, in 7 sessions), the tool-call machine (15) and the bash description (7); `vitest -u` run 151 times in 45 sessions | a wording change failing an unrelated machine test | keep prompt text in one snapshot file; other tests assert only the structure they care about |
| 7 | Browser tests that flake under load | test structure | called "flaky" 68 times in 27 transcripts, nearly always the chat row, draft row, attached-folder note and inline-link tests; an automatic detector (fail then pass with no edit between) found 19 | two browser tests failing in a full run and passing alone | fix or isolate those files; local retry like CI's; a checked-in list of known flakes |
| 8 | Stale build state hiding errors | tooling | 11 replies in 8 sessions blamed a stale `tsbuildinfo` or `node_modules` | an error the type check missed until the build info was deleted | type-check without incremental build info, or drop it when a `.d.ts` is newer |

Low signal, measured: Edit failures were rare (6 string-not-found, 2 multiple matches, 10 modified-since-read), Python edits failed their own assertions 49 times in 24 sessions, the Stop hook blocked 34 times (28 lint, 6 knip), and only 10 replies said outright that a concept could not be found (the flailing shows up as the multi-name searches in finding 4 instead).

## Corrections from the person

129 of the 1,865 messages matched correction phrases. Read by hand (est.), about 25 corrected the agent's own work and the rest were product direction. Those split as: a change left incomplete across the surfaces it applies to (~8), intent misread (~6), commit and formatting hygiene (~5), wireframes drawn from UI that no longer exists (2), and context missing from another branch (1). The first is the same root as finding 4: one action with several entry points and no owner.

## What has landed against it since

- Finding 1: `worktree.baseRef: "head"` in the repo's settings, `scripts/land.sh` (rebase onto main, types for the touched packages, lint and knip for the changed files, related tests, fast-forward main, install a changed lockfile, remove the worktree), and the setup hook already in place. A worktree was usable in 16 to 21 seconds in the pilot.
- Finding 2: the format hook records a file a Bash command writes when the command names it, in this repo and the other two that use the hook.
- Finding 4, partly: the chat's own session has one owner and `sessionRole` answers chat or task; the task-era names for the chat's folder and files are gone.
