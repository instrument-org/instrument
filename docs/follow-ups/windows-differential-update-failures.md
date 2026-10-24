# Why some Windows differential updates fail

**Status:** open · **Check after:** the next session with the Windows test host on · **Last checked:** 2026-10-24 (delta size measured; the failures not yet)

## What we're waiting to learn

41fc11ca3 counted the Windows test host's whole log: 67 differential update attempts, 62 succeeded and 5 failed. It said the failures "are real and unexplained, and this host hops between beta and latest, which is the shape of thing that would strand a stale base. That is worth its own look." Nobody has looked.

## The signal

electron-updater's differential download lines in the Windows main log. Count attempts and outcomes, not only `[error]` and `[warn]` lines, since a grep of warnings cannot show a success. For each failure, note the version it updated from and to, and whether the host had switched channels just before.

## Where to look

The installed app's main log on the Windows test host, and its updater cache. Trust only the cache folder `app-update.yml` names. An older build left another folder there, and its contents misled the first diagnosis.

## What each answer means

- **Failures cluster after a channel switch:** a stale cached installer is the base. Clear the cache when the channel changes.
- **Failures spread evenly:** read one failure's lines in full before deciding anything. A full download after a failed differential still installs, so this costs bandwidth, not updates.
- **No failures since the asar change:** close it.

## Result so far

2026-10-24: 71f074b07 stores the asar uncompressed so a delta costs roughly what changed. Measured from the published blockmaps, of a 448 MB installer: beta 100 to 101 downloads 38 MB (8%), and beta 101 to 102 downloads 141 MB (31%). That half is answered: deltas work and are a fraction of the full download.
