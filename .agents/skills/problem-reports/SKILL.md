---
name: problem-reports
description: Read problem reports people send from the app (feedback, crashes, hangs, errors) and tie fixes to them. Use when reading a report or a #customers card, writing back to the person who sent one, recording what you learned about one, or tying a commit to a report or a Slack thread, including one that went out without its line.
---

# Problem reports

Feedback, crashes, hangs and errors people send from the app are problem reports, each with a fingerprint (`feedback:<id>`), read with the reports CLI in the `internal` reference (`agent-reference get internal`). A #customers card's text names the report's id, linked to its page (`reports.tryinstrument.com/reports/<id>`), which `pnpm --filter @instrument/reports reports files <id>` reads there; `reports show <fingerprint>` lists the issue's reports, the commits made for it and its history.

## Tying a fix to its report

A fix is tied to its report by the commit alone:

- The commit carries `Report: <fingerprint>`, one line per report it fixes; `Report: <fingerprint> (partly)` when it leaves part of the report open, and `Related-report: <fingerprint>` for a change that fixes nothing. A squash-merged pull request carries the lines in its description, which becomes the commit's message.
- Once the commit is on `main`, the reports worker ties it to the issue within seconds of the push (within ten minutes when GitHub's webhook delivery fails), resolves it, and tells its Slack card; when a published release contains it, the issue records the version, and only a report from that version or later reopens it. Nothing is resolved by hand for a fix.
- What you learned that no commit records goes into the issue's history with `reports note <fingerprint> "<text>" --finding`: a cause, a report artifact that is not a bug, a complaint the fix leaves open. A commit that went out without its line is tied with `reports link <fingerprint> instrument <sha>`.

## Writing back

Writing back to the person who sent a report is done from the `internal` reference; its `AGENTS.md`, under Problem reports, says how. Write to people outside the team only that way, never from a personal account.

## Slack asks

A commit made for an ask in Slack (a teammate's thread, not a report) carries `Slack: <link to the thread's first message>` instead, and needs no issue: once it is on `main`, the reports worker replies once in that thread linking the commit. A commit can carry both kinds of line. One that went out without it is tied with `reports link-thread <link> instrument <sha>`. Never post to the thread yourself, and never file a Slack ask as a report to get the reply.
