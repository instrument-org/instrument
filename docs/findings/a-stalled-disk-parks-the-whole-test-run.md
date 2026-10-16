# A stalled disk parks whatever reads it, the app and a test run alike

**Status:** the app path is bounded; a test that walks the real file system with a real binary is still exposed.

An external disk can stop answering while staying attached. The device is still there (`diskutil list external` answers, `diskutil info` names it), but its file system has stopped responding, and every read of it blocks in the kernel forever. Nothing on a Mac times a blocking `open` out, and nothing cancels one.

## How to tell it apart from a hang in the code

```
$ for v in /Volumes/*; do timeout 3 ls "$v" >/dev/null && echo ok || echo SLOW; done
/Volumes/Macintosh HD: ok
/Volumes/Recovery: ok
/Volumes/Archive: SLOW
```

- `sample <pid> 3` and look at the main thread. A deadlock in our own code shows JavaScript frames; this one bottoms out in `open$NOCANCEL`, under `node::fs::ReadDir` or a `stat`.
- The process uses no CPU at all. A slow test burns CPU; this one does not.
- `diskutil unmountDisk force /dev/diskN` then `diskutil eject` gets the machine back, and both answer promptly even though reads do not.

## What it costs a Node process

A blocking file system call holds one of libuv's four thread pool threads for as long as it blocks, which here is forever. Two stalled volumes take half the pool; a path that reads them once per request leaks a thread per request until every file system call in the process waits behind the pool, whatever folder it was for. That is why one unresponsive disk can look like the whole program has stopped rather than one list being slow.

Vitest collects every test file before it runs any, so a single parked collection holds a whole package's run with nothing reported. The tell is a file that never reports even one case under `--testTimeout`: a timeout cannot fire on work that has not started.

## What reaches it in the app

Listing the computer's places. `computerPlaces` wants each disk where it really is, since `/Volumes` holds the boot volume as a link to `/`, so it asked `realpath` and `stat` about every volume with nothing bounding the answer. Windows drive letters already had that bound, for a mapped drive whose server is gone.

Both now go through one look-with-a-deadline: half a second, shared between askings so a disk that never answers holds one thread once rather than one more per asking, and a volume that misses the deadline is listed where it is mounted, the way the Finder keeps a disk it cannot reach in its sidebar. `lib/chat/computer-places.ts`.

That is the one place in the app that enumerates volumes. The permission rules name `/Volumes` as a place (`lib/permissions/places.ts`) but only as a path to match against, and matching reads nothing.

## What is still exposed

A test that runs a real binary over a real folder tree. `rg` and `du` walk what they are pointed at, under a real sandbox profile, and a walk that reaches `/Volumes` parks in the same syscall with no timeout anywhere in the test harness to stop it. This is what cost three sessions an hour each in one day before anyone sampled the process; which file did it was never isolated, because ejecting the disk fixed every one of them at once.

What would make it not matter is narrowing what those tests walk, so no test depends on which disks are plugged into the machine running it. Until then, the recipe above is the fastest way to tell a stalled disk from a bug.
