# Task file links resolve at render time, once per link

**Status:** resolved 2026-08-06. Recorded 2026-08-05. Both questions below were answered the same way: a reference draws from its path, nothing resolves at render, and the click establishes truth. The design is [file-references-without-a-watcher.md](../plans/completed/file-references-without-a-watcher.md), which has since landed in full. Kept because the reasoning still explains why the platform layer is not where a task file link belongs, and the guardrails below are all still live.

## Context

An agent names the files it produced in prose, and markdown renders those references as chips that open the file in the artifact panel. Existence is gated before the chip is drawn: [`TaskFileLink`](../../apps/studio/src/client/components/markdown.tsx) resolves the path first and falls back to plain text when nothing answers, so a hallucinated path degrades to ordinary prose instead of a button that does nothing.

Two sources can answer "does this path exist, and when did it change." The live task-file index is already in context and costs nothing to read. The `workspace.task.files.info` RPC costs one call per path. The index walks the task directory only, so a file under `/mnt` (a folder the user shared) can only come from the RPC.

Recorded because the per-link RPC reads as a small detail of one component and is really a choice about when file references resolve, which every surface that renders them inherits.

## What we found

**The platform layer is not where a task file link belongs, and it already says so.** [`guard-navigation.ts`](../../apps/studio/src/electron-main/lib/guard-navigation.ts) intercepts `will-navigate` and hands anything that is not the renderer to `openExternal`, whose allowlist is `http`, `https`, `mailto`, `tel` ([`open-external.ts`](../../apps/studio/src/electron-main/lib/open-external.ts)). A `file:` URL is refused there and captured as an exception. That refusal is deliberate and its rationale is in the docblock: the pages doing the linking are built from model output, so a scheme dressed up as a link must not get to pick a program.

Letting a real `file://` anchor through and catching the navigation in main would also not produce the behavior the link wants. Opening the artifact panel is renderer route state (`search.artifactPanel`), so main would have to resolve the mount path against the task's attached folders, work out which task the web contents belongs to, and hand control back to the renderer. It is a longer path to the same place, and none of it exists in the browser build (`apps/studio/web/`).

**A `file:` URL therefore has to be reduced to a path in the renderer.** react-markdown's `defaultUrlTransform` allows `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp` and empties everything else, so an unrecognized scheme arrives as an empty href rather than as itself. Rewriting `file:` URLs to their pathname in `urlTransform` puts them on the same footing as any other file reference. An emptied href renders as text, since an anchor with no target reads as a live link and does nothing.

**Resolution is eager and per-link.** The RPC fires only for paths under the attached-folder mount root, and TanStack Query deduplicates by key, so the fan-out is bounded by the number of distinct mounted files a message links rather than by file links generally. That is small today. It is still one round trip per reference, decided at render, for a file the user may never click.

**The session already carries most of the answer.** `write_file`, `edit_file`, and `generate_image` all report `filePath` and `modifiedAt` in their tool output, and those parts are persisted with the conversation. A renderer-side index over the current session's tool outputs would resolve the common case, a link to a file the agent just wrote, with no RPC at all. It is partial rather than complete: a file created through `bash` (`cp`, `mv`, a script) reports nothing, and any index built from past tool output goes stale the moment the user moves or deletes the file outside the app.

**Two questions, and they are coupled.** Any surface rendering agent-named file references has to answer both, and the answers should match across surfaces or the same file reads differently in different parts of one reply.

1. What does an unresolvable path render as? Plain text, which is invisible and hides the fact that the reply claimed a file, or a visible missing state, which is honest but draws attention to something that is not there.
2. When does resolution happen? At render, which is what makes question 1 answerable at all, or at click, which costs nothing until someone asks and is the only thing that can be accurate about a file deleted a minute ago.

Choosing a visible missing state for question 1 unblocks question 2: once existence no longer decides whether to draw anything, resolution is free to move to the click.

## What resolved it

**Resolution at click**, of the four options considered. The chip draws optimistically and the per-link query is gone, along with the fence's N-per-message equivalent.

The two questions turned out to be coupled in the opposite direction from the one recorded above. The note said choosing a visible missing state unblocks moving resolution to the click; what actually happened is that moving resolution to the click removed the need for a missing state at all, because an image's own asset request reports a missing file for free and everything else reports when acted on.

What replaced the existence check was not another lookup but a structural rule — is this a path the app can address — which is what still keeps a host path in model output from rendering as an affordance. The other two options, a session-derived index over tool outputs and a batched lookup, went unbuilt and are not needed by anything now.

## Guardrails

- **Do not add `file:` to the `openExternal` allowlist.** The allowlist is the reason a link in model output cannot choose a program on the user's machine.
- **Do not render an anchor with an empty href.** It is indistinguishable from a working link and is what an unhandled scheme degrades into.
- **Whatever resolves file references must work without Electron.** The browser build runs the same renderer, so a design that depends on main-process navigation handling is a design that only half exists.

## Related

- `71025d346`: `file:` links resolved and opened, and the per-link mount lookup this finding is about
- [asset-origin.md](../architecture/asset-origin.md): the per-task origin whose path space is the same virtual path space these references use
- [agent-sandbox.md](../architecture/agent-sandbox.md): why an agent-facing path is `/mnt/...` rather than a host path
