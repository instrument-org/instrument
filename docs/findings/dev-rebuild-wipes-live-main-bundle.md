# A dev rebuild wipes the running main process's bundle

## Symptom

In development, a bash tool call fails instantly (single-digit ms) with a
scrubbed module-resolution error attributed to whichever builtin ran first:

```plaintext
mkdir: Cannot find module '<path>' imported from <path>
```

Retrying seconds later succeeds. The agent has no way to tell this apart from a
real environment problem, so it burns turns diagnosing a phantom -- in the
observed case it probed `ls -la output && ffmpeg -version` before re-issuing the
identical FFmpeg commands, which worked first try.

The `<path>` redaction is just-bash's own error scrubber, which rewrites
absolute host paths before they reach the agent. It is not a separate bug, but
it does remove the one clue that would identify the failure.

## Root cause

`just-bash` registers every builtin as a lazily-imported chunk so a shell that
only runs `echo` never parses 100+ commands (`packages/just-bash/src/commands/registry.ts`
upstream, `dist/bundle/index.js` as shipped):

```js
{ name: "mkdir", load: async () => (await import("./chunks/mkdir-MEPGZOB6.js")).mkdirCommand }
```

Those chunks are bundled into the Electron main output, so at runtime the live
main process resolves them from `apps/studio/out/main/` on first use -- which
can be minutes into a session. Three facts then combine:

1. Vite empties `outDir` on **every** rebuild, not just the first. The
   `vite:prepare-out-dir` plugin does the work in `renderStart`, and its
   `options()` hook clears the once-guard at the start of each rebuild.
2. electron-vite's watch hook restarts only the Electron child it spawned
   itself (`if (ps) { ps.kill(); ps = startElectron(root) }`). It has no
   knowledge of any other instance.
3. Nothing stops two dev servers running against one checkout. Running Studio
   twice locally is normal here -- ports and the single-instance lock already
   accommodate it.

So a second dev server's rebuild deletes `out/main` under the first instance's
live main process, which keeps running against an in-memory bundle whose chunks
no longer exist on disk. Every lazy import for the rest of that rebuild fails.

This is not just-bash-specific. Of the 192 chunks in `out/main`, roughly 170 are
just-bash builtins and the rest are ours (`app-icon-stylized`, `token`,
`token-util`, `tailwind-browser`, and a dozen `index-*`). Any of them hit during
the window fails identically. `out/preload` has the same exposure: a window or
webview created while it is empty gets no preload script.

Production is unaffected. The packaged app reads its chunks from inside the
asar, and an auto-update restarts the process rather than rewriting it in place.

## Diagnosis trail

The dev logs (`apps/studio/.logs/`, one file per boot) pin it down without
guesswork, because the wipe leaves a timestamp:

- Two overlapping instances from one checkout: `15:28:56Z`-`15:34:26Z` and
  `15:29:05Z`-`15:49:29Z`.
- The failing tool call at `15:39:43.208Z`.
- Every one of the 193 files in `out/main` carrying an identical mtime of
  `15:39:44Z`, with `out/preload` at `15:39:45Z` and `out/renderer` untouched
  for days. Main plus preload but not renderer is the dev-server signature; a
  production build writes all three.
- No new log file and no gap in the surviving instance's log, so it was never
  restarted.

## Fix

`emptyOutDir: isProduction` on the `main` and `preload` builds in
`apps/studio/electron.vite.config.ts`. Dev rebuilds now overwrite in place
instead of clearing the directory, so a concurrent build cannot delete a chunk a
live process still needs. Chunk filenames are content-hashed, so superseded
files are inert; they accumulate in a gitignored directory until someone removes
`out/`. Builds still start from a clean directory, which is what keeps orphans
out of the asar.

Verified by placing a sentinel file in `out/main` and running the main build
with the config resolved for `serve`: it survives with `emptyOutDir: false` and
is deleted with `emptyOutDir: true`.

A residual window remains. Two dev servers still overwrite the same filenames,
so a process importing a chunk during the write can read a partial file. Both
servers build the same sources to the same content hashes, so the bytes match
and the window is a single file write rather than the whole rebuild -- roughly
three orders of magnitude narrower than deletion.

## Rejected alternatives

- **`inlineDynamicImports` for main in dev.** Immune, since nothing resolves
  from disk after boot. Rejected because it makes the dev bundle a single ~7 MB
  file and stops exercising the chunk-loading path we ship, trading a known
  failure for an unobserved one.
- **Externalizing just-bash so its chunks load from `node_modules`.** Covers
  ~170 of 192 chunks and leaves ours exposed. It also requires moving just-bash
  into Studio's `dependencies`, which changes what electron-builder packs into
  the asar -- real packaging risk for a dev-only fault.
