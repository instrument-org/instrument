# Reply language

How an agent's words become what a person reads in a chat: plain Markdown, laid out by the app for the chat's width, plus a few named blocks for what Markdown can't show. The agent says what something is; the app decides how it looks at the width it has.

## What the agent writes

Taught in the reply span of the system prompt ([system-prompt.ts](../../packages/workspace/src/model-text/system-prompt.ts)). A block is a fenced code block named for its kind, settings first as `key: value` lines, then its content:

| Block | For | Content |
| --- | --- | --- |
| `options` | Two to six things the person is choosing between | A table, first column the option; `pick:` names the recommended one |
| `chart` | Four or more numbers over time, or the parts of a total | A table, first column the labels; `type`, `unit`, `highlight` |
| `numbers` | The one to four figures the person came for | `Label: value (note)` per line |
| `timeline` | Three or more dated things in order | `date: what happened` per line; `# Day` heads a group |
| `files` | Every file the agent made or changed | One path per line |
| `message` | Words the person will send or paste, and any text the agent edits | Front matter, then the body |

Everything else is Markdown: tables, lists, math as `$…$` and `$$…$$`, a `mermaid` fence for a flow, a GitHub alert (`> [!WARNING]`) for a caveat that must not be missed, and a quote whose last line links to where its words came from.

Block names live in [constants.ts](../../packages/workspace/src/constants.ts) (`AGENT_*_LANGUAGE`) and [names.ts](../../apps/studio/src/client/components/reply-blocks/names.ts), which also reads the aliases models reach for (`compare`, `figures`).

## Reading what was meant

Models slip, so the renderer reads leniently and never shows a slip as broken markup ([`reply-blocks/`](../../apps/studio/src/client/components/reply-blocks/)):

- `normalizeReplyBlocks` reads `:::name` directives and `<name>` tags as the same fences, in chat messages only, so a `.md` file opened in the app shows as written. In a finished reply, a block whose closer was left out ends at its first blank line.
- `normalizeMathDelimiters` reads `\(…\)`, `\[…\]` and single-dollar math by Pandoc's rule, in chat messages only, and never inside code.
- A block that does not parse falls back to the code block it is.

## Laying out for the width

Decided while the Markdown is parsed and switched by CSS container queries on the transcript's width, with no measuring in script:

- **Tables** (`table-shape.ts`, `rehype-table-shape.ts`): one that fits stays a table; one that doesn't stacks into records when it has six rows or fewer (a total row aside), and otherwise scrolls with its first column held. Short cells never wrap. A total row (Total, Sum, a bare All) reads as one line. A two-column table of amounts written with a unit gets a bar beside each amount. A table still arriving is drawn plain until its block closes, so it doesn't jump while it streams.
- **Chips and code** (`rehype-unbroken-inline.ts`): labels up to `UNBROKEN_LABEL_MAX` characters never break across lines.
- **Charts** turn their bars sideways when narrow. **Options** become records at a phone's width, the pick tinted.
- **Diagrams** draw with [pele](https://github.com/obsidianmd/pele) ([mermaid.ts](../../apps/studio/src/client/lib/mermaid.ts)), which turns a left-to-right flowchart too wide for any chat column vertical (`directionBreakpoint`) rather than shrinking its labels.

## Edits on a message

An agent editing text writes only the new version in a `message` block. The card finds what it replaced ([message-edits.ts](../../apps/studio/src/client/components/reply-blocks/message-edits.ts)): the person's messages and earlier message blocks in the chat, from `MessageEditSourcesContext`, newest first, so a second pass compares with the draft before it. A candidate counts when enough of the new words match it in order and some sit in runs of three or more shared words; a reply to a pasted email shares almost no such runs. Once the block is closed, the card gets Original · Revised. Revised is the clean text, its new words tinted while the card is pointed at (always, where nothing hovers), each telling what it replaced; Original copies the original.

## Checking it

- Parsers and layout rules have unit tests beside them in `reply-blocks/`.
- How the prompt's teaching lands with models is an eval question: run the reply cases on Claude Haiku 5.5, the floor, and a stronger model (`workspace-evals` skill). Haiku uses fewer blocks than stronger models do, which is why the renderer makes plain Markdown read well by itself.
