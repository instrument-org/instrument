# A third sighting of the quit-teardown livelock

**Status:** open, passive · **Check after:** 2026-12-01, or at once after an update that left the app spinning with no window · **Last checked:** 2026-10-24

## What we're waiting to learn

[`quit-teardown-can-livelock-the-app.md`](../findings/quit-teardown-can-livelock-the-app.md) has two sightings, both on macOS, both when installing an update from the prompt. The app quit its window but kept a process at full CPU. The finding records what is known. This check exists so a third sighting gets captured instead of force-quit and forgotten: it would confirm or drop the leading suspect (a home-folder search with an `EPERM` neighbor) and show which microtask spins after the last stage line.

## The signal

- A process left at 100% CPU with no window after `Quitting to install the staged update`. That is the sighting itself.
- In the main log, the last `Quit teardown: <stage>` line before the process was killed. Normal is `exiting`.
- Not evidence: a missing `exiting` line on its own, since a quit can end before the log flushes. Also not evidence: `graceful_exit: true` in a crash report, which the finding shows lies for this failure.

## Where to look

Any Mac that just installed an update from the prompt. When it happens, sample the spinning process before killing it (`sample <pid> 5`), and keep that output with the log.

## What each answer means

- **A sighting with a sample:** add it to the finding as the third sighting, and name the spinning frame.
- **No sighting by the check date:** move the date out once. Close it after that if update installs have kept working, and leave the finding open.
