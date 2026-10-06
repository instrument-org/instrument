# The packaged log keeps cheap lines on by default and gates only what is expensive to gather

Date: 2026-10-06

## Context

Studio sends no telemetry. The packaged build's `main.log` (`logs/main.log` under the app's user-data directory, 8 MB cap, written asynchronously; see `apps/studio/src/electron-main/lib/electron-logger.ts`) reaches us only when someone is asked for feedback and chooses to attach it. Most logs will never leave the machine, which raises the question of whether lines that are unlikely to be reported should be written at all, or kept behind developer mode.

A week of real use on one machine wrote about 1,200 lines. The auto-updater accounted for about 500 of them; the per-press line for agent clicks (`agent press … hit=… target=…`, in `browser-view/dispatch-command.ts`) accounted for 30. Those 30 lines were how a silent click miss and a shadow-DOM blind spot in the click check were found, since the agent's own transcript only ever says `✓ Done`.

Options weighed:

- **Detailed lines in developer mode only.** Keeps the log small, but the log that does get attached to feedback comes from a user who never turned developer mode on, so it lacks the detail. A user cannot be asked to enable a mode and reproduce something intermittent.
- **Only in dev builds.** Dev runs are not real-world use, and dev builds write `apps/studio/.logs/*.jsonl` rather than `main.log` anyway.
- **Gate by what a line costs to produce, not by how likely it is to be read.** Chosen.

## Decision

Three tiers, decided by what a line costs to produce and what it carries:

- **On by default:** cheap lines at the rate of things that happen: one per agent action, refusal, navigation, or update check. Writing one costs a few hundred bytes of a capped file. These are what make an attached log useful.
- **Developer mode only** (`isDeveloperMode()` in `electron-main/stores/workspace/preferences.ts`): lines that need extra work to gather (an extra script run in a page, timing probes, screenshots), and lines at high frequency (per frame, per keystroke, per network request).
- **Never written:** page content, text the user or agent typed, and the addresses of pages the user or agent visited. Once logs can be attached to feedback, this is a privacy line, not a size one. Instrument's own endpoints (the update feed, model providers) are fine.

The agent press line stays on by default. It runs one hit-test script in the guest and one in the host before each press, a few milliseconds, which is worth paying on the path that decides whether the agent's clicks land. If the gateway grows a refusal for presses that would hit nothing interactive, that check needs the same hit test on every press, and the line comes free.

## Consequences

- An attached log can answer "did the agent's click land" without asking the user to reproduce anything.
- New log lines are judged by the tiers above rather than by whether anyone is likely to read them.
- Known gap: `did-fail-load` in `browser-view/manager.ts` writes the full failed URL, query string included. On real use that put Gmail data URLs carrying tokens, and LAN hostnames, into `main.log`. Most of those lines are `errorCode=-3` (aborted loads), which are noise as well.

## Implementation

- [Log file transport](../../apps/studio/src/electron-main/lib/electron-logger.ts)
- [Agent press line](../../apps/studio/src/electron-main/browser-view/dispatch-command.ts)
