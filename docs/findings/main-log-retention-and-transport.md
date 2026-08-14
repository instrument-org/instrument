# The main log is sized for today's volume, not the volume we are about to add

**Status:** partly addressed. Rotation and write mode changed 2026-08-14; the transport question is open.

## Context

`<userData>/logs/main.log` is written by electron-log in packaged builds only ([electron-logger.ts](../../apps/studio/src/electron-main/lib/electron-logger.ts)). Today it carries boot timings, updater activity, and errors, and it is the only durable record of what a shipped build did on a user's machine.

[privacy-first-diagnostics-and-feedback.md](../plans/active/privacy-first-diagnostics-and-feedback.md) Phase 1 adds span records, a main-thread stall watchdog, and the event and exception catalog to that same process. Both of electron-log's file-transport defaults are wrong for that, in ways that are invisible at current volume.

## What we found

**Retention is adequate now and collapses under the planned volume.** Two files on a developer machine, one archive deep:

| File           | Span                      | Size    | Rate      |
| -------------- | ------------------------- | ------- | --------- |
| `main.old.log` | 2026-06-04 to 2026-07-29  | 1.00 MB | 19 KB/day |
| `main.log`     | 2026-07-29 to 2026-08-14  | 517 KB  | 33 KB/day |

At 1 MB rotation that is 30 to 55 days per file and roughly two to three months across both. A 20x increase, which is conservative for per-turn spans plus a watchdog, gives **1.5 days per file and about three days total**. Even 5x lands under two weeks.

**Rotation keeps exactly one archive.** electron-log 5.4.1 `src/node/transports/file/index.js`: `archiveLogFn` renames `main.log` to `main.old.log` and overwrites whatever was there. There is no `maxFiles`. Raising `maxSize` is the only lever short of supplying a custom `archiveLogFn`.

**Writes are synchronous by default.** Same file, `sync: true`, reaching `fs.writeFileSync` in `File.js`. Every main-process log call is a blocking syscall on the thread that owns the window. This is the thread the plan's stall watchdog exists to protect: FP-1223 was a twelve-second main-process freeze that made the OS paint "Not Responding" over a launching app. Multiplying synchronous file I/O on that thread by 20 is adding load to the exact failure mode being instrumented.

**What a real investigation cost.** Establishing that a 52-second update install was an outlier rather than a regression needed six weeks of installs to correlate zip size against install duration. Three logs contributed, and the useful ones were not ours:

- Squirrel's `ShipIt_stderr.log`: nine installs over six weeks in 38 KB, append-only, never rotated. This is what made the correlation possible.
- Our `main.log`: version and zip size per release.
- The macOS unified log: the only source for the per-second forensics, and the only one that had already aged out. It is Apple's, capped system-wide, and not adjustable in anything we ship.

Squirrel's file survives six weeks in 38 KB because it writes one line per milestone rather than per operation. That is the design point: a low-volume milestone stream bounded by age outlives a high-volume debug stream bounded by size, and mixing them into one rotating file means the debug stream evicts the milestones.

## What changed

`maxSize` raised to 8 MB and `sync` set to false. The second introduces a trade worth stating: electron-log's async path queues into `asyncWriteQueue` and drains via `fs.writeFile` with no flush API and no drain on exit, so lines still queued when the process dies are lost. That window is one write round trip, but it covers the last lines before a crash, which are the ones worth having. Crash diagnostics are Crashpad minidumps under the plan's Phase 3, not this file, so the exposure is bounded; a transport with explicit flush-on-quit removes it entirely.

## What might resolve it later

**Split the streams before adding volume.** Milestones (version transitions, install outcomes, boot results) bounded by age and kept for months; debug output bounded by size and kept for days. One rotating file cannot serve both.

**The diagnostics journal is not a logging-library problem.** The plan specifies typed records against an existing catalog, sanitized on write, in the same storage idiom as conversation storage, and explicitly warns against a second storage idiom for diagnostics. A general-purpose logger would be that second idiom. This finding is about `main.log`, whose job the plan already shrinks by retargeting boot timings off electron-log.

**If the transport is replaced, LogTape over evlog.** Evaluated from documentation only; neither was built with, and LogTape's file sinks were not verified against a packaged asar.

- LogTape (`@logtape/logtape` 2.3.1) is library-first and silent until configured, so `workspace` and `ai-gateway` can log through hierarchical categories without imposing configuration, which matches the existing `createScopedLogger(scope)` seam. Zero dependencies at 5.3 KB min+gzip. `getRotatingFileSink({maxSize, maxFiles})` and `getTimeRotatingFileSink({interval, maxAgeMs})` cover the size-and-age bounding the plan asks for; `nonBlocking` plus `flushInterval` addresses the write-mode trade properly. It has `redactByField`/`redactByPattern` for defense in depth.
- evlog (2.26.0) is well matched to a diagnostics journal on its merits, with wide events, typed fields, and auto-redaction. Two reasons against it here: its center of gravity is drains to hosted analytics backends, which is the posture the plan is removing, and its wide-event model duplicates the record types the plan already specifies, so adopting it means choosing between its model and ours.
- electron-log is maintained, not stale. The case against it is design (string formatting, console swizzling, two-file rotation, no structured records, no redaction, no age bound), not abandonment.

## Related

- [privacy-first-diagnostics-and-feedback.md](../plans/active/privacy-first-diagnostics-and-feedback.md): the journal, spans, and stall watchdog this is sized for
- [update-check-un-stages-the-macos-build.md](./update-check-un-stages-the-macos-build.md): the other updater finding drawn from these logs
