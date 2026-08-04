# Plan: how the agent presents files, data, and artifacts

Status: proposal, not started. Owner: TBD. Shippable independently of, and ahead of, the folder work in [user-chosen-working-folder.md](user-chosen-working-folder.md).

## What the agent can express

A vocabulary written directly into the response, composing what the user sees:

- **A file**, mentioned in prose or embedded at a chosen prominence.
- **A group** of files, laid out as a grid, a list, or snippets.
- **A folder**, as an expandable tree.
- **A pair**, compared side by side.
- **A skill**, referenced rather than only reported when it changes.
- **Records from connected apps**, in the same shapes.
- **An action**, opening something into the artifact panel.

Two rules separate the last item from the rest, and everything else follows from them.

### What this replaces

Two mechanisms currently infer presentation from side effects, and both are the same mistake:

- Files written to `output/` become previews automatically, keyed off a magic directory.
- Skill changes become a card automatically, produced by diffing the workspace skills directory across a turn ([workspace-skill-index.ts](../../../packages/workspace/src/lib/workspace-skill-index.ts), rendered by [skill-changes-card.tsx](../../../apps/studio/src/client/components/skill-changes-card.tsx)).

The consequence is that the agent can only surface a skill it just _mutated_. A user asking "do we have a skill for this?" has no representation at all, which is the same gap retrieval had for files.

**A change record and a presentation are different things and should stay different.** What a turn touched is reported to the user, automatically, and belongs with the file change list. What the agent chooses to show is composed by the agent, explicitly. The skill-change card stays; the automatic `output/` rule goes.

## Rules

1. **Markup describes, actions do.** Presentation renders identically every time a conversation is reopened. Anything with a side effect is a tool call, fires once, and is recorded in the transcript.
2. **Degrade to something correct.** Every construct stays useful when nothing parses it: in a copied transcript, an export, or a half-streamed response.
3. **The agent describes intent; the renderer chooses the widget.** The agent says what it is showing and how prominent it should be. It never names a component, and never needs to know whether a path is an image, a document, or a directory.
4. **One node, one component family.** Files and connector records parse into the same shape and render through the same components.
5. **Hints are advisory.** Unknown attributes are ignored. Unsupported combinations fall back. The renderer may override a layout when it knows better, such as rendering chat messages as rows even when a grid was asked for.

## Files

### Mentioning one

```markdown
I updated [the revenue chart](output/revenue.png) with Q3 numbers.
```

A link in prose renders as a chip that opens a preview. This is the default, and it needs no new syntax.

### Showing one

```markdown
:file[output/hero.png]{size=lg}
```

### A group

```markdown
:::files{layout=grid}

- [Revenue by month](output/revenue.png)
- [Costs by category](output/costs.png)
- [Regional split](output/regions.png)
  :::
```

The container wraps ordinary markdown links. Unparsed, it is a bulleted list of working links with human labels.

Bare paths and globs work as items where a label adds nothing:

```markdown
:::files{layout=grid columns=6 size=sm}

- output/frames/\*.png
  :::
```

### Layouts

| Layout     | Shape                                                 | Use                                                   |
| ---------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `grid`     | Uniform cards, thumbnail interior varies by file type | Sets of results, mixed or not                         |
| `list`     | Rows with name, path, and size                        | Enumerations where identity matters more than content |
| `snippets` | Rows with matched content and the path retained       | Retrieval, where the user needs to recognize the file |
| `tree`     | Expandable, nestable, expanded by default             | Folders, which contain folders                        |
| `compare`  | Two items, aligned and same scale, labeled            | Before and after, two candidates, a diff              |

Layout is inferred when unstated: one item is a card, several images are a grid, a directory is a tree, exactly two comparable items offered as a comparison is `compare`.

**Uniform card height is load-bearing for `grid`.** A mixed set of formats reads as one result only if every card is the same object with a different thumbnail interior: an image preview, ruled lines for text, a small table for tabular data, a page for documents. Letting one item expand inline to show an excerpt is what turns a result into an accordion.

### Attributes

| Attribute | Values                                        | Applies to | Notes                                   |
| --------- | --------------------------------------------- | ---------- | --------------------------------------- |
| `layout`  | `compare`, `grid`, `list`, `snippets`, `tree` | Container  | Inferred when absent                    |
| `size`    | `sm`, `md`, `lg`, `full`                      | Either     | Prominence, not pixels                  |
| `columns` | number                                        | Container  | Grid only, advisory                     |
| `preview` | `none`, `thumb`, `excerpt`                    | Either     | Leading content for text-like files     |
| `expand`  | boolean                                       | Item       | Tree nodes; the root expands by default |

## Skills and connector records

The same containers accept skills and records from connected apps. The syntax is identical; only the item source differs.

```markdown
:::items{layout=list}

- [PDF forms](skill://pdf-forms)
- [Renewals playbook](notion://page/3f81a0)
- [Renewal reminders fire twice](linear://issue/ENG-4471)
  :::
```

Sources differ in what they can offer. A page has a cover and a body; a skill has a description and no image; an issue has a status; a mail thread has neither. One card shape absorbs all of it:

- Source mark and title are required. Everything else is optional.
- The media slot is a fixed height, filled by a cover when one exists and a labeled band when not, so a mixed grid never goes ragged.
- One metadata line, bottom-aligned across cards regardless of title length.
- Snippets are clamped to two lines and simply absent when there is no description or body text.
- **A source supplies data, never a layout.** It cannot introduce a new card shape.

Skills lead with their description rather than an image, so they read best as rows. Chat messages do too. This is the main case for the renderer overriding a requested layout.

Unavailable items still render. A disconnected app, a revoked permission, or an uninstalled skill are normal states, shown dimmed with a way to restore, because the user may recognize the item and want it back.

## Actions

Opening a file, a folder, or a web page into the artifact panel is a tool call, not markup.

- The transcript records it collapsed to a sentence a person can read months later, expandable for anyone who wants the detail.
- It fires once, when the agent takes it. Reopening the conversation does not reopen anything.
- Closing the panel does not erase the record, and the record stays clickable. A later click is the user opening something, which is fine.
- Opening is never the only route to a file. Everything shown can already be revealed.

The natural home is the bash surface the agent already uses, where `open` composes with everything else it does. A dedicated tool is the alternative, and has a clearer permission story for targets outside the sandbox.

## The parsed node

Syntax is the surface. This is the contract:

```ts
{
  kind: "files" | "items",
  layout?: "compare" | "grid" | "list" | "snippets" | "tree",
  size?: "full" | "lg" | "md" | "sm",
  items: Array<{
    source: "glob" | "path" | "record" | "skill" | "url",
    value: string,
    label?: string,
    attrs?: Record<string, string>,
  }>,
}
```

`source` is why files, skills, and connector records share a component family, and why a source added later costs nothing at the grammar level. Skills are the proof: they were built as a bespoke card with its own watcher and its own component, and they collapse into one more value in this union.

## Resolution

Globs and directories resolve on the workspace side, against the task's mounts, respecting the file index's ignore rules and capped at a sane item count. A match past the cap renders as a folder with a count, not as a thousand cards.

**Resolution happens once, when the message is emitted, and the resolved list is persisted.** A conversation therefore keeps meaning what it meant. A file deleted afterwards renders as a tombstone rather than disappearing from the record.

## States

Every component ships with three:

- **Streaming.** The parser sees an unterminated container long before it sees a close. Skeletons hold the space; raw syntax never flashes on screen.
- **Missing.** A file that no longer exists renders dimmed and named, not omitted.
- **Unavailable.** A connector record whose service is disconnected renders with a reconnect path.

## Validating it

The binding constraint is what models emit unprompted, mid-task, not what the renderer can parse. Prototype the syntax, run it across models with the eval CLI, and read the transcripts, checking whether the model reaches for the container at all, gets attributes right without reminders, and avoids wrapping single files in groups.

## Phases

1. **Parser and node schema.** A single file and a flat group. No globs, no trees.
2. **Component family.** Card, grid, list, snippets, tree, compare.
3. **Resolution.** Globs and directories, with caps and persisted results.
4. **Prompt.** Describe the vocabulary; delete the automatic `output/` preview rule.
5. **Actions.** Opening into the artifact panel.
6. **Skills as a source**, replacing the bespoke card path with the shared one.
7. **Connector records**, when the first connector needs them.

Phases 1 and 2 are worth prototyping before the syntax is final, because the components will show which attributes are load-bearing.

## Open questions

- Does the inline single-file form earn its place, or is a container of one enough?
- Does a group need a title of its own, beyond per-item labels?
- How much should the renderer infer? Inference is friendly to the model and unpredictable to the designer.
- Does `compare` extend to text and PDF diffs in the first version, or only images?
