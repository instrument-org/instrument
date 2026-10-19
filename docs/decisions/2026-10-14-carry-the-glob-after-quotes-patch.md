# Carry just-bash's fix for a glob after a quoted folder as a local patch

Date: 2026-10-14

Narrows [2026-08-27-no-local-just-bash-patches.md](2026-08-27-no-local-just-bash-patches.md), which stands for everything else, the same way the earlier `carry-the-*-patch` decisions do.

## Context

On macOS every chat's work folder is under `~/Library/Application Support/Instrument/` (a preview build's under `Instrument Preview (<branch>)`), and just-bash 3.6.0 cannot glob after a quoted path that holds a space or parentheses. `"$INSTRUMENT_WORK"/*` read the folder with the backslashes that kept its quoted characters literal still in the path, matched nothing, and then split the word at every space, so `for f in "$INSTRUMENT_WORK"/*` looped over three paths that do not exist in every chat. The escaped path also reached the Permissions rules, which did not know it as the app's own data and raised a card asking the person for it.

## Options weighed

**Rewrite the word downstream.** Not tried: the glob runs inside the interpreter's word expansion, and anything we could do from outside (rewriting the command text, or unescaping paths in the filesystem wrapper) would re-derive quoting rules just-bash already holds, which is what [the rmdir decision](2026-10-03-carry-the-rmdir-patch.md) ruled out for filesystem gaps.

**Patch the published bundle.** Chosen. The fix is upstream as [vercel-labs/just-bash#588](https://github.com/vercel-labs/just-bash/pull/588): `GlobExpander` unescapes the segments before the first glob before they become a path, counts an escaped glob character as literal, and an unmatched word is the word minus its quoting, split only where an unquoted expansion produced its text. It applies to the 3.6.0 tag unchanged, and its new import of `glob-escape.ts` into `shell/glob.ts` keeps the bundle's chunks, so the rebuild maps it.

The rules' half, a backslash-escaped spelling of the app's own data being asked for, is ours and is fixed in the rules themselves (`reachOf`, `holdsAppData`) rather than left to the patch, since a word the agent quotes oddly can still spell a path that way.

## Decision

Carry the twentieth part of `patches/just-bash@3.6.0.patch`, pinned to #588, until it is in a version we install. `create-bash-env-glob.test.ts` is the guard: in a work folder whose path holds a space, parentheses and brackets, each glob prints what bash prints in the same folder.
