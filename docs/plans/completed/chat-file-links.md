# Interactive task-file links in chat

Status: **landed, and the rest was overtaken.** Owner: TBD. Explicit links render as interactive file chips with a right-click menu. Bare-path auto-linking, the one phase left, is no longer wanted: the agent is now told not to link files at all.

## What this solved

The agent wrote an ordinary Markdown link to a file it produced:

```md
[Download the redacted image](output/redacted_x.png)
```

and the renderer did not honor it. Every non-`#` link went to `ExternalLink`, whose RPC input is `z.url()`, so a task-relative path failed the schema and degraded to "path copied to clipboard + error toast."

`TaskFileLink` in [markdown.tsx](../../../apps/studio/src/client/components/markdown.tsx) now renders such a link as a chip — file-type icon plus label — that opens the file in the task pane on click and offers the file-actions menu (Download / Reveal / Copy / Add to chat / Open in {App}) on right-click. Bare `![](output/x.png)` image paths resolve against the asset origin too.

## What changed underneath it

Two later pieces of work moved the ground this plan was standing on, and both are worth knowing before touching the chip.

**Existence gating is gone.** This plan proposed resolving every reference through a live task file index (`CurrentTaskFilesProvider`) so a path matching no real file could degrade to plain text. [file-references-without-a-watcher.md](file-references-without-a-watcher.md) deleted that index. A chip is now drawn from the path alone, gated on `isAddressableTaskFilePath` ([task-file-path.ts](../../../packages/workspace/src/lib/task-file-path.ts)) — a question about the string, not about disk. A hallucinated path renders as a chip and reports itself missing when clicked, which is deliberate: degrading to prose hid that the reply claimed a file at all, and it is the only answer that can be right about a file deleted after the message was written. A host path like `/Users/someone/.ssh/id_rsa` still reads as prose, because it is not addressable.

**Links are no longer how files reach the user.** The main agent prompt now says files "are shown rather than linked," and the ` ```files ` fence ([presentation-syntax.md](../active/presentation-syntax.md)) is how a reply hands them over — once, in the fence, never also as a link. That reverses this plan's premise, which was that the agent writes links constantly and the renderer should honor them.

## Why the remaining phase is not being built

Phase 3 was a remark plugin auto-linking bare paths in prose, so the agent would rarely need explicit link syntax. Under the current prompt the agent is directed away from writing file paths in prose at all, so the plugin would mostly fire on the cases the prompt is trying to eliminate, and turn them into affordances that compete with the fence directly above them.

`TaskFileLink` stays because links still occur — in a previewed Markdown file, in reasoning, in older transcripts — and a chip is the right rendering when one does. It is the fallback, not the path.

Reopen this only if the fence stops being the way files are handed over.

## Open questions, if it is ever reopened

1. Chip affordance for non-previewable types (e.g. `.zip`): the pane cannot preview it, so the click should probably Download or Reveal rather than open an empty tab. Decide per `getFileType`.
2. Middle/cmd-click must not escape into the OS browser. The chip is a `<button>` rather than an `<a>`, so there is no DOM `href` to sanitize; keep it that way.
