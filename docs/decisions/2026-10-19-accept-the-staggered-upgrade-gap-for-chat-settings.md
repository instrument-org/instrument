# Accept that a computer on the previous build stops seeing chat settings from an upgraded one

**Date:** 2026-10-19

Each device keeps a chat's per-chat values in a file only it writes. The build before this one called it `marks.<device>.jsonl` and wrote `t: "mark"` lines; this one calls it `settings.<device>.jsonl` and writes `t: "set"` lines (commit `41b385be1`, "workspace: keep a chat's settings in settings.<device>.jsonl"). An upgraded device takes its own marks file over under the new name the first time it writes to it.

The previous build reads only `marks.*.jsonl` and skips any line it does not recognize. So while one computer has upgraded and another sharing the workspace has not, the one on the previous build loses every title, star, archive, unread mark and topic the upgraded computer set, including the ones it set before upgrading, since that file has moved to the new name. Nothing is lost on disk: the upgraded build reads both names and both line kinds, so the second computer sees everything once it upgrades too.

## Decision

The gap is accepted, with no compatibility path for the previous build. The rename was made before the first non-beta 2.0 release, when the 2.0 betas had two users, both able to upgrade every computer they use at once. A shape that will be read for years is worth getting right at the one point where changing it costs a few days of missing labels on a computer that has not upgraded yet.

## Rejected

- **Keep the `marks` file name and the `mark` line, and only add fields.** The file was never only marks: it holds every per-chat value a device sets, the model among them, and the old name would mislead every reader of the layout from now on.
- **Write both files during a transition.** Each file has one writer and is only appended to; a second copy written beside it doubles every write and leaves two files to disagree after a crash, for a gap that closes when the other computer upgrades.
- **Have the upgraded build write `mark` lines into the old name until every device upgrades.** No device can tell when every other device has upgraded, so the transition would never end.

## Consequences

- During a staggered upgrade, a computer on the previous build shows chats without the labels another computer set. Upgrading it restores them.
- Readers keep taking `marks.<device>.jsonl` and `t: "mark"` lines as settings until no device writes them, which the chat records document ([chat-records.md](../architecture/chat-records.md)).
- A later change to a stored shape that synced devices share does not get the same allowance once 2.0 has users who upgrade on their own schedule.
