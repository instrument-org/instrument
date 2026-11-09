# Why Claude account sessions cold-start, counted over real use

**Status:** open · **Check after:** a week of real chats on a Claude account · **Last checked:** 2026-11-08 (no Claude account requests in the inspected activity)

## What we're waiting to learn

A Claude account turn that cannot resume its Claude Code session starts cold and replays the history. That is slower and costs more. a919e0422 logs every cold start with its reason "so a day of use can be counted by cause". The counts say which resume path is worth fixing first.

## The signal

`[claude-account] session <slot> cold start (<tag>), <native|text> replay of N messages: <detail>`, from `packages/ai-gateway/src/lib/providers/claude-account/language-model.ts`. The tag is `restart`, `transcript`, `fork`, `no-record`, `shape` or `busy`. Count by tag, and compare with the number of Claude account turns in the same period, since cold starts per turn is the rate that matters.

## Where to look

The installed app's main log on a machine where chats ran on a Claude account, from v2.0.0-beta.100.

## What each answer means

- **Mostly `restart`:** sessions do not survive an app restart. Look at what the resume record keeps across launches.
- **Mostly `transcript` or `shape`:** the stored Claude Code transcript no longer matches what we would send. Look at what changes the history between turns.
- **Mostly `fork`:** tasks pay for starting cold. That cost may be accepted by design, so record it rather than fix it.
- **`busy`:** two turns raced for one session. Look at turn serialization.
- **Cold starts are rare per turn:** close it.

## Result

Checked 2026-11-08 on the primary Mac, the laptop and the Windows test host. No Claude-account cold-start warning appeared in their retained main logs. The inspected activity contains no requests through a Claude account: 476 rows on the primary Mac since October 24, 296 rows in the laptop's daily-use workspace since October 29, and 295 rows on Windows from November 4 through 7. The laptop's separate test workspace also has no Claude-account requests in its October 24–25 sample.

This supplies no denominator for account resumption, so zero cold starts does not establish that resumption works. Leave this open until the connection has a week of real use; a calendar-only reminder would repeat the same empty check. Requests to Claude models through Instrument do not exercise the Claude-account session path.

## Next check

Wait for normal Claude-account use; no dedicated test session is needed. After a week of qualifying chats, compare the cold-start reasons with the account's request count.
