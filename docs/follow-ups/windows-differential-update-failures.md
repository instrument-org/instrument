# Why some Windows differential updates fail

**Status:** closed 2026-10-24: the failures are a stale base, every one recovered with a full download, and nothing needs changing · **Last checked:** 2026-10-24

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

## Result

2026-10-24, delta size: 71f074b07 stores the asar uncompressed so a delta costs roughly what changed. Measured from the published blockmaps, of a 448 MB installer: beta 100 to 101 downloads 38 MB (8%), and beta 101 to 102 downloads 141 MB (31%). Deltas work and cost a fraction of the full download.

2026-10-24, failures: the test host's log, April to October, holds 91 differential attempts. 81 succeeded and 10 failed, every failure the same `Cannot download differentially, fallback to full download: Error: sha512 checksum mismatch`. The differential rebuilds the new installer on top of the cached one, which it assumes is the running version's. In 7 of the 10 it was not:

- 5 came after a second update arrived while an earlier one was downloaded and not yet installed, so the cache held that newer installer: from the same running version, the first update succeeded and the next one failed.
- 2 came after the app had been installed outside the updater (a hand-installed build, or a hop between channels), so the cache held an older installer.

The other 3 have no such cause visible in the log. All 10 fell back to a full download, which installed. A person on one channel who installs each update before the next arrives does not hit this, and one who does pays a full download, not a failed update, so it is not worth a fix.
