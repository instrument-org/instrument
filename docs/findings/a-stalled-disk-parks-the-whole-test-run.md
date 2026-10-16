# A stalled disk parks the whole test run

**Status:** open, and not a bug in the code. Found 2026-10-16 on the branch, reproduced on `workspace-layout` as well.

A whole-package run of the workspace suite stops reporting after one file and never finishes. It is not slow: the worker sits at 0% CPU with no child process, and the run has to be killed. Three sessions in one day each lost an hour to it before anyone sampled the process.

## What it is

The worker is parked in a single syscall. `sample <pid>` gives the same stack for every sample:

```
node::fs::ReadDir  →  uv_fs_scandir  →  scandir  →  __opendir2  →  open$NOCANCEL
```

`open` on a directory never returns. The directory is on an external disk that has stopped answering:

```
$ for v in /Volumes/*; do timeout 3 ls "$v" >/dev/null && echo ok || echo SLOW; done
/Volumes/Macintosh HD: ok
/Volumes/Recovery: ok
/Volumes/T7 2TB BLK: SLOW
/Volumes/T7 Time Machine: SLOW
```

The device is still attached (`diskutil list external` answers, `diskutil info /dev/disk7` names it), so nothing has been unplugged; its filesystem has stopped responding. Reading it is what blocks, and nothing on a Mac times a blocking `open` out.

## Why a test reaches it

The permission rules list every drive on the computer the way the person sees them: `{ id: "drives", paths: ["/Volumes"] }` in `lib/permissions/places.ts`, read each time the rules are built so a disk plugged in later is covered from the next command. A test that builds real rules against the real machine therefore reads `/Volumes`, and on a machine with a stalled disk that read never returns.

`lib/app-data-rules.test.ts` is where it bites, because its table is built while the file is collected: with `--testTimeout=3000 --hookTimeout=3000` the file still never reports a single case, which is the tell that nothing has started running yet. Vitest collects every file before it runs any, so one parked collection holds the run, and the rest of the package looks like it stalled.

## How to tell it apart from a hang in the code

- `sample <worker pid> 3` and look at the main thread. A deadlock in our own code shows JavaScript frames; this one bottoms out in `open$NOCANCEL`.
- The worker uses no CPU at all. A slow test burns CPU; this one does not.
- Running the same file from another checkout, or with the records install taken out of `test/setup.ts`, changes nothing.
- The slices that do not build real rules (`src/lib/apps`, `src/lib/shell-commands`, `src/lib/chat`, `src/lib/records`) all pass in minutes.

## What would make it not matter

Nothing in the product: a person whose disk has stopped answering has a stalled disk, and an agent reading their folders would park on it the same way. What could change is the test's reach, which is the part under our control: the rules it builds could be given a fixed list of drives rather than the machine's, the way `windowsDrives` already takes an `exists` for its tests. That would also make the file's table the same on every machine.

Until then, a machine with a stalled volume cannot finish the suite, and the fix is to that machine.
