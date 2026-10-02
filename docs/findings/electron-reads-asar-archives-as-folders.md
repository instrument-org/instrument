# Electron reads an app's archive as a folder

**Status:** `du` fixed; the rest of the sandbox and the This Mac screen still affected. Last checked 2026-10-02: `process.noAsar` is still set only in the `du` worker, and nothing reads through `original-fs`.

## What happened

Asked for the largest app in /Applications, a task ran `du -sk /mnt/Applications/*` and reported Figma.app at 4.30 GiB. It is 0.29 GiB on disk, and Xcode is the largest. Fifteen apps came out larger than they are, every one of them an Electron app, and nothing else was off.

## Why

Electron patches `node:fs` to treat any path segment ending in `.asar` as a folder holding the files packed in the archive. Every Electron app ships its code as `Contents/Resources/app.asar`, so to Electron's `fs` that file is a directory, and a walk counts the archive twice: once as the file it is and once as the folder it appears to be. The sizes inside come from the archive's own header and are not checked against anything; Figma's lists a `.codesign` entry of 4,294,966,296 bytes, just under 2³², which is where the 4 GiB came from.

Plain Node has no such patch, so `pnpm script:run-bash` and the unit tests report the right size and cannot reproduce it. Running the same walk under `ELECTRON_RUN_AS_NODE=1` with the repo's Electron binary reproduces the task's number to the kilobyte.

## What was fixed

`du` walks in a worker of its own (`lib/shell-commands/du.ts`), and that worker sets `process.noAsar = true`. The setting is per thread: measured, a worker that sets it reads `app.asar` as a file while the main thread beside it still reads it as a folder. The `du` worker loads no code after it starts, so nothing of the app's own is read through it.

## What is still affected

Run in the app against a folder holding an Electron app:

| Command | Says about `app.asar` |
| --- | --- |
| `ls -la` | a directory |
| `stat -c '%F %s'` | `directory 0` |
| `find` | 137 entries inside it |
| `wc -c` | No such file or directory |

The This Mac screen (`listComputerFolder` in `lib/orchestrator/computer.ts`) lists it as a folder too.

The same switch does not work in the bash worker. just-bash loads each command's code on first use with `import()` from its package folder, and in a packaged build that folder is inside Instrument's own `app.asar`; with archive support off, the first `ls` would fail to load. The main thread cannot take it either, for the same reason.

## What might resolve it

Route by path rather than by thread: in the bash worker, and for the This Mac listing, call `original-fs` (Electron's unpatched module) for every path outside `process.resourcesPath`, and the patched `fs` only for the app's own files. just-bash takes no filesystem argument, so this means replacing the path-taking functions on the worker's `fs` and `fs.promises` with a dispatcher, which is invasive enough to want its own test under Electron rather than under Node.
