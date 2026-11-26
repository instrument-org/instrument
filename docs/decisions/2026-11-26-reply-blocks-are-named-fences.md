# Reply blocks are named fences, and edits live on the message

Date: 2026-11-26

## Context

Chat replies needed a way to show comparisons, charts, key figures, plans and edited text at any width without the agent building UI. Four eval rounds on Claude Haiku 5.5, Sonnet 5.5 and GPT-6.2 compared wrappers (fenced code blocks, `:::` directives, `<tag>`s), teachings and renders, with blind judges reading each reply as drawn at 768 and 420 pixels.

## Decision

- A block is a fenced code block named for its kind (` ```options `). The wrapper changed nothing in how often or how well models used a block; fences are what the app already read for files, messages and timelines, and what models write by habit. `:::` and tags are read as the same fences, so a slip draws the same.
- The vocabulary is small and names content, never layout: options, chart, numbers, timeline, files, message. Everything else stays Markdown, and the renderer lays Markdown out for the width (tables that stack or scroll, amount bars, unbreakable chips), since weaker models use few blocks.
- Edited text is a `message` holding only the new version, and the app finds the original. A separate changes block made the agent copy the person's text back before its edit, split edits of an email from the card that sends it, and was used only for "tighten this"; models also put such edits in a message unprompted.
- An edit opens on the revised text. Strikethrough markup, as Word and Google Docs show it, buried a tightened email under its cut words; new words are tinted instead, and what each replaced shows on pointing.
- Diagrams draw with pele in place of mermaid: labels stay readable in a narrow chat, where mermaid shrank them to a few pixels, and it renders many times faster.

## Consequences

- Haiku still restates a numbers block's figures in the sentence above it; rewording the teaching did not move it, and the repeat was accepted.
- Text the person sent as a file, rather than pasted, has no original for the card to find.
- Pele is young and mostly one maintainer's; it is pinned to an exact version.

## Implementation

- [Reply language](../architecture/reply-language.md) maps the pieces.
