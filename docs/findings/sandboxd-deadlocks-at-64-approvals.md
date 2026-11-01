# sandboxd deadlocks at 64 approvals in flight, and the app could send 64

**Status:** contained: Node's file thread pool is 16 (`apps/studio/src/electron-main/thread-pool.ts`) and reads of workspace files are capped at 8 open at once (`packages/workspace/src/lib/workspace-files.ts`). Which reads made up the burst that set it off is not known. Seen on macOS 26.6 with 2.0.0-beta.120, 2026-11-01.

## What happened

With the workspace in iCloud Drive, the app beach-balled with the main thread in a synchronous `readdirSync`, blocked in the kernel's `open()` at 0% CPU. Force quit was the only way out, and a relaunch hung the same way before its first window, in a synchronous `open` while the main bundle's modules were still evaluating. Other apps were stuck too: Raycast's approvals timed out in the same minutes.

## The mechanism

A process that reads a cloud provider's files (a File Provider domain, iCloud Drive's `com.apple.CloudDocs` among them) can need macOS's approval first, `kTCCServiceFileProviderDomain`. The kernel parks the reading thread and asks `sandboxd`, which asks `tccd` and passes the answer back.

`sandboxd` handles each request on a dispatch worker thread that waits on a semaphore for `tccd`'s answer, and the answer is delivered on another dispatch worker thread. libdispatch allows 64 such threads. With 64 requests in flight, all 64 threads are waiting and none is left to deliver an answer, so none ever arrives. A spindump of `sandboxd` showed 64 of its 65 threads in `_dispatch_semaphore_wait_slow`, all last run at the same moment, under `Dispatch Thread Soft Limit Reached: 64 (too many dispatch threads blocked in synchronous operations)`. `tccd` had answered every request with a grant.

From then on, every approval on the computer waits: the kernel logs `Sandbox: watchdog expired for approval entry N (kTCCServiceFileProviderDomain, pid P)` every few seconds per waiting thread, and the read that asked never returns. It lasts until `sandboxd` is restarted (`sudo killall sandboxd`) or the computer is.

The app sent exactly 64 such requests within about 10 ms. Node's thread pool was 64, so 64 reads could be in flight at once. The awaited fan-outs over workspace files (the chat index build's `Promise.all` over every chat folder, the folder fingerprint's per-folder `Promise.all`, the downloads that wait for evicted files) put that many into iCloud together. Before they were async, the same reads ran one at a time on the main thread; with Node's default pool of four, async reads could not reach 64 either.

## What is not known

- Which reads asked. Not every read needs approval: a later session on a fresh `sandboxd` sent four at launch and none when opening Settings > Storage, and the chat logs there were all on disk. The evicted files in that workspace were mostly the layout migration's leftovers under `.instrument/.pre-chats`, other devices' `state.<device>.json`, attachments and blobs.
- What makes `sandboxd` ask again. Its answers seem to be kept for a while, since a 21-hour session sent one request before the burst.
- Whether the first hung `readdirSync` was on a folder iCloud kept by name only. Listing such a folder downloads it, so a `readdir` is not the free metadata call it is on local disk.

## Diagnosing it again

- `/usr/bin/log show --last 30m --predicate 'process=="kernel" AND eventMessage CONTAINS "approval"' --style compact` (in zsh, `log` alone is a builtin) shows the watchdog lines and which pids are waiting.
- `sandboxd` logging nothing at all while those lines keep coming means it is wedged.
- `sudo spindump $(pgrep -x sandboxd) 10 -file <file>` before restarting it shows whether its threads are the 64 waiting ones.
- A dev build launched from a terminal may not take this path at all: a read from a terminal reached evicted iCloud files with no approval request. Check it with the installed app opened from Finder or `open`.

## What keeps it away

Stay well under 64 requests in flight, from every source together: the thread pool is 16, and `workspace-files.ts` lets 8 reads of workspace files be open at once. A new fan-out over workspace files goes through that module, and the pool does not go back up without a cap in front of every read that can reach a synced folder.
