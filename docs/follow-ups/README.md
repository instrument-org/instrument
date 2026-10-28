# Follow-ups

Checks we owe later: a question only time or real use can answer, and the evidence that will answer it. A change that ships logging, a counter or a cap "to see what happens" is a bet on a future look, and this is where that look is written down so it happens. One Markdown file per follow-up.

A follow-up is neither a finding nor a plan. A finding records an issue we understand; a plan records work we will do. A follow-up records what we are waiting to learn, and many are not problems at all ("does this cap ever trip?").

## Shape

- Open with `**Status:** open · **Check after:** <date, or a condition such as a build having run somewhere for a week> · **Last checked:** <date or never>`. When it closes, the status says how: resolved, closed as not recurring, or moved to a finding or plan, with a link.
- **What we're waiting to learn:** the question, what prompted it, and the commit that collects the evidence.
- **The signal:** the exact log line, counter or behavior to look for, and what each one means. Include what it means when none of them shows up.
- **Where to look:** which logs or reports, described by kind of machine, never by name.
- **What each answer means:** the action each outcome leads to, decided now so the check is a lookup rather than a fresh investigation.
- **Result:** filled in when closed: what was seen, how often, on which platforms, and the commit that acted on it.

Commits that install the evidence carry a `Follow-up: docs/follow-ups/<file>.md` trailer, and the follow-up names those commits, so each can be found from the other.

## Keeping it safe to publish

Describe a signal by its log text as a pattern, never a pasted excerpt. Leave out host names, accounts, home folders, people's content and third-party names (the knowledge-base rules in [`../README.md`](../README.md) apply). A result records counts and conclusions, not log lines.

## Working with them

When work touches an area with an open follow-up whose check date has passed, read it and do the check, or say why it cannot be done yet and move the date. Close it by filling in the result and the status, and update the index below in the same change.

## Index

Open first, earliest check first; closed ones after.

| Follow-up | Check after | Status |
| --- | --- | --- |
| [How often and how long the main thread stalls](main-thread-stalls.md) | 2026-11-14, after a week on a beta with the attribution fix | open |
| [Which processes stay busy, and whether tab sleep ended the hidden-tab cost](sustained-cpu-and-tab-sleep.md) | 2026-11-07, after a week on beta 102 | open |
| [Why Claude account sessions cold-start](claude-account-cold-starts.md) | 2026-11-07, after a week of Claude account chats | open |
| [Why reply streams drop partway](dropped-reply-streams.md) | 2026-11-11, after a week on a beta with the cause capture | open |
| [Why an agent-browser command sometimes never comes back](stuck-agent-browser-commands.md) | 2026-11-21, after a week on the test hosts | open |
| [Whether the step and output caps ever trip](step-and-output-caps.md) | 2026-11-21 | open |
| [Whether ChatGPT citation markers are common enough to strip](chatgpt-citation-marker-rate.md) | 2026-11-21 | open |
| [A third sighting of the quit-teardown livelock](quit-teardown-livelock.md) | 2026-12-01 | open, passive |
| [What a second computer shows of a chat whose task waits on a card](multi-computer-sync-audit.md) | when using one workspace from more than one computer is taken on | open |
| [How often the app restarts itself to install an update](automatic-update-restarts.md) | two releases on a beta that restarts on its own | open |
| [Why the stopped-reply test fails on Linux CI](stopped-reply-words-on-disk.md) | | closed 2026-10-26: the test sent Stop before the reply had words |
| [Why some Windows differential updates fail](windows-differential-update-failures.md) | | closed 2026-10-24: a stale base, recovered by a full download |
